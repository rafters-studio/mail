// TCP to WebSocket: mail apps speak TCP, Workers take WebSockets, and this carries octets between
// them knowing nothing of IMAP. RFC 6455 5.6: "The "Payload data" is arbitrary binary data whose
// interpretation is solely up to the application layer." Form 01a19daa, The bridge.

use std::collections::HashMap;
use std::future::pending;
use std::net::{IpAddr, Ipv6Addr};
use std::process::ExitCode;
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use futures_util::stream::{SplitSink, SplitStream};
use futures_util::{SinkExt, StreamExt};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt};
use tokio::net::tcp::{OwnedReadHalf, OwnedWriteHalf};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::Semaphore;
use tokio::time::{Instant, interval_at, timeout};
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::http::header::AUTHORIZATION;
use tokio_tungstenite::tungstenite::protocol::WebSocketConfig;
use tokio_tungstenite::tungstenite::{Bytes, Message};
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream, connect_async_with_config};

const MAX_PROXY_LINE: usize = 107;
const MAX_FRAME: usize = 1024 * 1024;
// A frame per read, and well under MAX_FRAME so an idle connection does not hold 1 MiB.
const READ_SIZE: usize = 64 * 1024;
const PROXY_WAIT: Duration = Duration::from_secs(5);
const CONNECT_WAIT: Duration = Duration::from_secs(10);
// A stalled peer must not keep a slot after the other side has gone.
const CLOSE_WAIT: Duration = Duration::from_secs(5);
const PING_EVERY: Duration = Duration::from_secs(30);

type Worker = WebSocketStream<MaybeTlsStream<TcpStream>>;
type Log = Arc<dyn Fn(&str) + Send + Sync>;
type Counts = Arc<Mutex<HashMap<IpAddr, u16>>>;

struct Settings {
    target: String,
    authorization: HeaderValue,
    port: u16,
    max_connections: u16,
    max_per_address: u16,
    ping: Duration,
}

/// Reads every setting, refusing to start with a message naming the one that is wrong.
fn settings(env: impl Fn(&str) -> Option<String>) -> Result<Settings, String> {
    let required = |name: &str| {
        env(name)
            .filter(|value| !value.is_empty())
            .ok_or(format!("{name} is required"))
    };
    let number = |name: &str, default: u16| match env(name) {
        Some(value) => value
            .parse()
            .map_err(|_| format!("{name} must be a number from 0 to 65535")),
        None => Ok(default),
    };
    let target = required("TARGET_URL")?;
    check_target(&target)?;
    let authorization = HeaderValue::from_str(&format!("Bearer {}", required("BRIDGE_SECRET")?))
        .map_err(|_| "BRIDGE_SECRET cannot be sent in a header".to_owned())?;
    Ok(Settings {
        target,
        authorization,
        port: number("PORT", 1143)?,
        max_connections: number("MAX_CONNECTIONS", 256)?,
        max_per_address: number("MAX_PER_ADDRESS", 16)?,
        ping: PING_EVERY,
    })
}

/// Mail and passwords cross this link, so it is wss:// except on loopback.
fn check_target(target: &str) -> Result<(), String> {
    let request = target
        .into_client_request()
        .map_err(|_| "TARGET_URL is not a URL".to_owned())?;
    let uri = request.uri();
    match uri.scheme_str() {
        Some("wss") => Ok(()),
        Some("ws") if uri.host().is_some_and(is_loopback) => Ok(()),
        _ => Err("TARGET_URL must be wss://, except on loopback".to_owned()),
    }
}

/// What counts as loopback for the one exception to wss://: the name localhost, or an IP address
/// that is loopback, including one mapped into IPv6. A host that only starts with either is not.
fn is_loopback(host: &str) -> bool {
    host == "localhost"
        || host
            .trim_matches(['[', ']'])
            .parse::<IpAddr>()
            .is_ok_and(|ip| ip.to_canonical().is_loopback())
}

/// Reads the PROXY v1 line, at most 107 octets, and gives the source address and whatever came
/// after the line: TCP splits anywhere, so the first command can arrive in the same read.
async fn read_proxy_line(tcp: &mut (impl AsyncRead + Unpin)) -> Option<(IpAddr, Vec<u8>)> {
    let mut line = [0u8; MAX_PROXY_LINE];
    let mut filled = 0;
    while filled < MAX_PROXY_LINE {
        let read = tcp.read(&mut line[filled..]).await.ok()?;
        if read == 0 {
            return None;
        }
        filled += read;
        if let Some(end) = line[..filled].windows(2).position(|pair| pair == b"\r\n") {
            let source = proxy_source(&line[..end])?;
            return Some((source, line[end + 2..filled].to_vec()));
        }
    }
    None
}

/// The source address of a PROXY v1 line given without its CRLF. Anything but a TCP4 or TCP6 line of
/// six fields gives `None`, and the caller closes.
fn proxy_source(line: &[u8]) -> Option<IpAddr> {
    let line = std::str::from_utf8(line).ok()?;
    let fields: Vec<&str> = line.split(' ').collect();
    match fields[..] {
        ["PROXY", "TCP4" | "TCP6", source, _, _, _] => source.parse().ok(),
        _ => None,
    }
}

/// One routed /64 is one client and a mapped address is its IPv4, as the Worker's logins count them.
fn client_address(source: IpAddr) -> IpAddr {
    match source.to_canonical() {
        IpAddr::V6(v6) => IpAddr::V6(Ipv6Addr::from_bits(v6.to_bits() & (u128::MAX << 64))),
        v4 @ IpAddr::V4(_) => v4,
    }
}

/// A connection's hold on its address's count, given back however the connection ends.
struct AddressSlot {
    counts: Counts,
    address: IpAddr,
}

impl AddressSlot {
    /// Holds a slot for this address, or `None` at `MAX_PER_ADDRESS`, and the caller closes.
    fn take(counts: &Counts, address: IpAddr, max: u16) -> Option<Self> {
        let mut held = counts.lock().unwrap_or_else(PoisonError::into_inner);
        let count = held.get(&address).copied().unwrap_or(0);
        if count >= max {
            return None;
        }
        held.insert(address, count + 1);
        Some(Self {
            counts: Arc::clone(counts),
            address,
        })
    }
}

impl Drop for AddressSlot {
    /// Gives the slot back, and forgets an address with none left, so the map stays bounded by the
    /// connections open now.
    fn drop(&mut self) {
        let mut held = self.counts.lock().unwrap_or_else(PoisonError::into_inner);
        if let Some(count) = held.get_mut(&self.address) {
            *count -= 1;
            if *count == 0 {
                held.remove(&self.address);
            }
        }
    }
}

/// Opens the one WebSocket for this connection; `None` is any failure, and the caller closes.
async fn open_worker(settings: &Settings, address: IpAddr) -> Option<Worker> {
    let mut request = settings.target.as_str().into_client_request().ok()?;
    let headers = request.headers_mut();
    headers.insert(AUTHORIZATION, settings.authorization.clone());
    headers.insert(
        "x-client-address",
        HeaderValue::from_str(&address.to_string()).ok()?,
    );
    let config = WebSocketConfig::default()
        .max_frame_size(Some(MAX_FRAME))
        .max_message_size(Some(MAX_FRAME));
    let connecting = connect_async_with_config(request, Some(config), true);
    let (worker, _) = timeout(CONNECT_WAIT, connecting).await.ok()?.ok()?;
    Some(worker)
}

/// Client to Worker, and the ping: a mail app in IDLE says nothing, and something on the way to
/// Cloudflare will otherwise drop the connection. A failed send does not end the copy, since the
/// Worker's last bytes may still be waiting to be read; the other direction ends it.
async fn client_to_worker(
    client: &mut OwnedReadHalf,
    worker: &mut SplitSink<Worker, Message>,
    first: Vec<u8>,
    ping: Duration,
) -> &'static str {
    if !first.is_empty() && worker.send(Message::binary(first)).await.is_err() {
        return pending().await;
    }
    let mut buffer = vec![0u8; READ_SIZE];
    let mut pings = interval_at(Instant::now() + ping, ping);
    loop {
        let sent = tokio::select! {
            read = client.read(&mut buffer) => match read {
                Ok(0) | Err(_) => return "client-closed",
                Ok(count) => worker.send(Message::binary(buffer[..count].to_vec())).await,
            },
            _ = pings.tick() => worker.send(Message::Ping(Bytes::new())).await,
        };
        if sent.is_err() {
            return pending().await;
        }
    }
}

/// Worker to client. Frames are written whole before the next is read, so a close that follows a
/// reply takes effect after the reply. The Worker never sends text, so a text frame ends it.
async fn worker_to_client(
    worker: &mut SplitStream<Worker>,
    client: &mut OwnedWriteHalf,
) -> &'static str {
    loop {
        match worker.next().await {
            Some(Ok(Message::Binary(octets))) => {
                if client.write_all(&octets).await.is_err() {
                    return "client-closed";
                }
            }
            Some(Ok(Message::Text(_))) => return "text-frame",
            Some(Ok(Message::Close(_))) | None => return "worker-closed",
            Some(Ok(Message::Ping(_) | Message::Pong(_) | Message::Frame(_))) => {}
            Some(Err(_)) => return "worker-failed",
        }
    }
}

/// Copies both ways at once, because a client and a Worker each blocked on writing to the other
/// would hang one loop doing both. Either direction ending closes both sides.
async fn copy(tcp: TcpStream, worker: Worker, first: Vec<u8>, ping: Duration) -> &'static str {
    let (mut client_read, mut client_write) = tcp.into_split();
    let (mut worker_sink, mut worker_stream) = worker.split();
    let end = tokio::select! {
        end = client_to_worker(&mut client_read, &mut worker_sink, first, ping) => end,
        end = worker_to_client(&mut worker_stream, &mut client_write) => end,
    };
    // Each side is closed whatever the other does, so neither result changes anything.
    let _ = timeout(CLOSE_WAIT, worker_sink.close()).await;
    let _ = client_write.shutdown().await;
    end
}

/// One connection from accept to close. Gives the address, once known, and how it ended.
async fn connection(
    mut tcp: TcpStream,
    settings: &Settings,
    counts: &Counts,
) -> (Option<IpAddr>, &'static str) {
    let Ok(Some((source, first))) = timeout(PROXY_WAIT, read_proxy_line(&mut tcp)).await else {
        return (None, "no-proxy-line");
    };
    let address = client_address(source);
    let Some(_slot) = AddressSlot::take(counts, address, settings.max_per_address) else {
        return (Some(address), "over-address-cap");
    };
    let Some(worker) = open_worker(settings, address).await else {
        return (Some(address), "worker-unreachable");
    };
    (Some(address), copy(tcp, worker, first, settings.ping).await)
}

/// One line per connection, and never an octet: mail and passwords are in the clear here.
fn log_line(address: Option<IpAddr>, end: &str, started: Instant) -> String {
    let address = address.map_or("-".to_owned(), |ip| ip.to_string());
    let seconds = started.elapsed().as_secs();
    format!("connection address={address} end={end} seconds={seconds}")
}

/// Accepts forever. The slot is taken at accept, so a connection still silent about its PROXY line
/// counts against `MAX_CONNECTIONS`.
async fn serve(listener: TcpListener, settings: Arc<Settings>, log: Log) {
    let slots = Arc::new(Semaphore::new(usize::from(settings.max_connections)));
    let counts = Counts::default();
    loop {
        let Ok((tcp, _)) = listener.accept().await else {
            continue;
        };
        let started = Instant::now();
        let Ok(slot) = Arc::clone(&slots).try_acquire_owned() else {
            log(&log_line(None, "over-connection-cap", started));
            continue;
        };
        let (settings, counts, log) =
            (Arc::clone(&settings), Arc::clone(&counts), Arc::clone(&log));
        tokio::spawn(async move {
            let _slot = slot;
            let (address, end) = connection(tcp, &settings, &counts).await;
            log(&log_line(address, end, started));
        });
    }
}

/// Refuses to start on bad settings or a port it cannot hold, exiting with a message; otherwise
/// listens on `[::]:PORT`, the address Fly's handlers forward to, and logs to stderr.
#[tokio::main]
async fn main() -> ExitCode {
    let settings = match settings(|name| std::env::var(name).ok()) {
        Ok(settings) => settings,
        Err(message) => {
            eprintln!("bridge: {message}");
            return ExitCode::FAILURE;
        }
    };
    let listener = match TcpListener::bind(("::", settings.port)).await {
        Ok(listener) => listener,
        Err(error) => {
            eprintln!("bridge: cannot listen on PORT {}: {error}", settings.port);
            return ExitCode::FAILURE;
        }
    };
    serve(
        listener,
        Arc::new(settings),
        Arc::new(|line: &str| eprintln!("{line}")),
    )
    .await;
    ExitCode::SUCCESS
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used, clippy::result_large_err)]
mod tests {
    use super::*;
    use std::net::SocketAddr;
    use tokio::sync::mpsc;
    use tokio_tungstenite::accept_hdr_async;
    use tokio_tungstenite::tungstenite::handshake::server::{Request, Response};

    const LINE: &[u8] = b"PROXY TCP4 192.0.2.1 198.51.100.1 5000 993\r\n";
    const SECRET: &str = "s3cret-bearer";
    const PATIENCE: Duration = Duration::from_secs(5);

    type Fake = WebSocketStream<TcpStream>;
    type Seen = mpsc::UnboundedReceiver<(Fake, HashMap<String, String>)>;

    /// A fake Worker: each accepted WebSocket arrives on the channel with its request headers.
    async fn fake_worker() -> (String, Seen) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("ws://{}/imap", listener.local_addr().unwrap());
        let (tx, rx) = mpsc::unbounded_channel();
        tokio::spawn(async move {
            while let Ok((tcp, _)) = listener.accept().await {
                let tx = tx.clone();
                tokio::spawn(async move {
                    let headers = Arc::new(Mutex::new(HashMap::new()));
                    let held = Arc::clone(&headers);
                    let callback = move |request: &Request, response: Response| {
                        for (name, value) in request.headers() {
                            held.lock().unwrap().insert(
                                name.as_str().to_owned(),
                                value.to_str().unwrap().to_owned(),
                            );
                        }
                        Ok(response)
                    };
                    if let Ok(ws) = accept_hdr_async(tcp, callback).await {
                        let seen = headers.lock().unwrap().clone();
                        let _ = tx.send((ws, seen));
                    }
                });
            }
        });
        (url, rx)
    }

    /// A running bridge with the given settings over the required ones, and its log.
    async fn bridge(
        url: &str,
        given: &[(&str, &str)],
        ping: Option<Duration>,
    ) -> (SocketAddr, Arc<Mutex<Vec<String>>>) {
        let mut all: HashMap<String, String> = given
            .iter()
            .map(|(k, v)| ((*k).to_owned(), (*v).to_owned()))
            .collect();
        all.insert("TARGET_URL".to_owned(), url.to_owned());
        all.insert("BRIDGE_SECRET".to_owned(), SECRET.to_owned());
        let mut read = settings(|name| all.get(name).cloned()).unwrap();
        if let Some(ping) = ping {
            read.ping = ping;
        }
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let lines = Arc::new(Mutex::new(Vec::new()));
        let held = Arc::clone(&lines);
        let log: Log = Arc::new(move |line: &str| held.lock().unwrap().push(line.to_owned()));
        tokio::spawn(serve(listener, Arc::new(read), log));
        (address, lines)
    }

    async fn client(address: SocketAddr, opening: &[u8]) -> TcpStream {
        let mut tcp = TcpStream::connect(address).await.unwrap();
        tcp.write_all(opening).await.unwrap();
        tcp
    }

    async fn accepted(seen: &mut Seen) -> (Fake, HashMap<String, String>) {
        timeout(PATIENCE, seen.recv()).await.unwrap().unwrap()
    }

    /// The next octets from the Worker's side, skipping control frames. `None` once it closes.
    async fn next_octets(ws: &mut Fake) -> Option<Vec<u8>> {
        loop {
            match timeout(PATIENCE, ws.next()).await.unwrap() {
                Some(Ok(Message::Binary(octets))) => return Some(octets.to_vec()),
                Some(Ok(Message::Ping(_) | Message::Pong(_))) => {}
                _ => return None,
            }
        }
    }

    async fn worker_reads(ws: &mut Fake, want: usize) -> Vec<u8> {
        let mut all = Vec::new();
        while all.len() < want {
            all.extend(next_octets(ws).await.unwrap());
        }
        all
    }

    async fn worker_sees_close(ws: &mut Fake) {
        assert_eq!(next_octets(ws).await, None);
    }

    /// True when the peer closed within the wait, by end of stream or reset; false if still open.
    async fn closes_within(tcp: &mut TcpStream, wait: Duration) -> bool {
        let mut buffer = [0u8; 1024];
        timeout(wait, async {
            loop {
                if matches!(tcp.read(&mut buffer).await, Ok(0) | Err(_)) {
                    return;
                }
            }
        })
        .await
        .is_ok()
    }

    fn pattern(length: usize, seed: u8) -> Vec<u8> {
        (0..length)
            .map(|i| i.to_le_bytes()[0] ^ (i >> 8).to_le_bytes()[0] ^ seed)
            .collect()
    }

    #[tokio::test]
    async fn fr_mail_037_c1() {
        let (url, mut seen) = fake_worker().await;
        let (address, _) = bridge(&url, &[("MAX_PER_ADDRESS", "1000")], None).await;

        // A chunk split anywhere, both ways, with every byte value in it.
        let chunk: Vec<u8> = (0u8..=255).step_by(5).chain([0, 13, 10, 255]).collect();
        for split in 0..=chunk.len() {
            let mut tcp = client(address, LINE).await;
            let (mut ws, _) = accepted(&mut seen).await;
            tcp.write_all(&chunk[..split]).await.unwrap();
            tcp.flush().await.unwrap();
            tokio::task::yield_now().await;
            tcp.write_all(&chunk[split..]).await.unwrap();
            assert_eq!(worker_reads(&mut ws, chunk.len()).await, chunk);

            ws.send(Message::binary(chunk[..split].to_vec()))
                .await
                .unwrap();
            ws.send(Message::binary(chunk[split..].to_vec()))
                .await
                .unwrap();
            let mut back = vec![0u8; chunk.len()];
            tcp.read_exact(&mut back).await.unwrap();
            assert_eq!(back, chunk);
        }

        // A 25 MiB message each way at once, which a loop doing both in turn could hang on.
        let up = pattern(25 * 1024 * 1024, 1);
        let down = pattern(25 * 1024 * 1024, 2);
        let tcp = client(address, LINE).await;
        let (ws, _) = accepted(&mut seen).await;
        let (mut tcp_read, mut tcp_write) = tcp.into_split();
        let (mut ws_sink, mut ws_stream) = ws.split();

        let up_sent = up.clone();
        // Hands the half back: dropping it half-closes the client, and closing closes both.
        let client_writes = tokio::spawn(async move {
            tcp_write.write_all(&up_sent).await.unwrap();
            tcp_write
        });
        let down_sent = down.clone();
        let worker_writes = tokio::spawn(async move {
            for frame in down_sent.chunks(MAX_FRAME) {
                ws_sink.send(Message::binary(frame.to_vec())).await.unwrap();
            }
        });
        let worker_reads_up = tokio::spawn(async move {
            let mut all = Vec::new();
            while all.len() < 25 * 1024 * 1024 {
                let message = ws_stream.next().await.unwrap().unwrap();
                if let Message::Binary(octets) = message {
                    assert!(octets.len() <= MAX_FRAME);
                    all.extend_from_slice(&octets);
                }
            }
            all
        });
        let mut got_down = vec![0u8; down.len()];
        let _tcp_write = timeout(Duration::from_secs(60), client_writes)
            .await
            .unwrap()
            .unwrap();
        timeout(Duration::from_secs(60), tcp_read.read_exact(&mut got_down))
            .await
            .unwrap()
            .unwrap();
        worker_writes.await.unwrap();
        assert!(got_down == down, "the 25 MiB coming down differs");
        assert!(
            worker_reads_up.await.unwrap() == up,
            "the 25 MiB going up differs"
        );
    }

    #[tokio::test]
    async fn fr_mail_037_c2() {
        let (url, mut seen) = fake_worker().await;
        let (address, _) = bridge(&url, &[], None).await;

        // Split byte by byte, then the first command on its own.
        let mut tcp = TcpStream::connect(address).await.unwrap();
        for octet in LINE {
            tcp.write_all(&[*octet]).await.unwrap();
            tcp.flush().await.unwrap();
            tokio::task::yield_now().await;
        }
        tcp.write_all(b"a1 NOOP\r\n").await.unwrap();
        let (mut ws, headers) = accepted(&mut seen).await;
        assert_eq!(headers["x-client-address"], "192.0.2.1");
        assert_eq!(worker_reads(&mut ws, 9).await, b"a1 NOOP\r\n");

        // Sent with the first command, an IPv6 address cut to its /64.
        let opening = b"PROXY TCP6 2001:db8:1:2:3:4:5:6 2001:db8::1 5000 993\r\na2 NOOP\r\n";
        let _v6 = client(address, opening).await;
        let (mut ws, headers) = accepted(&mut seen).await;
        assert_eq!(headers["x-client-address"], "2001:db8:1:2::");
        assert_eq!(worker_reads(&mut ws, 9).await, b"a2 NOOP\r\n");

        // A mapped address is its IPv4.
        let opening = b"PROXY TCP6 ::ffff:192.0.2.9 2001:db8::1 5000 993\r\na3 NOOP\r\n";
        let _mapped = client(address, opening).await;
        let (mut ws, headers) = accepted(&mut seen).await;
        assert_eq!(headers["x-client-address"], "192.0.2.9");
        assert_eq!(worker_reads(&mut ws, 9).await, b"a3 NOOP\r\n");
    }

    #[tokio::test]
    async fn fr_mail_037_c3() {
        let (url, mut seen) = fake_worker().await;
        let (address, _) = bridge(&url, &[], None).await;

        // No PROXY line: a client's first command in its place.
        let mut none = client(address, b"a1 LOGIN me hunter2\r\n").await;
        assert!(closes_within(&mut none, PATIENCE).await);

        // One over 107 octets closes; exactly 107 is a line.
        let sized = |length: usize| {
            let start = b"PROXY TCP4 192.0.2.1 198.51.100.1 5000 ";
            let mut line = start.to_vec();
            line.resize(length - 3, b'0');
            line.extend_from_slice(b"1\r\n");
            line
        };
        let mut long = client(address, &sized(108)).await;
        assert!(closes_within(&mut long, PATIENCE).await);
        assert!(seen.try_recv().is_err(), "neither reached the Worker");
        let _exact = client(address, &sized(107)).await;
        accepted(&mut seen).await;

        // Silent for 5 seconds: it closes then, and counts against MAX_CONNECTIONS until then.
        let (capped, _) = bridge(&url, &[("MAX_CONNECTIONS", "1")], None).await;
        let mut silent = TcpStream::connect(capped).await.unwrap();
        tokio::time::sleep(Duration::from_millis(100)).await;
        let mut excess = client(capped, LINE).await;
        assert!(closes_within(&mut excess, Duration::from_secs(1)).await);
        assert!(!closes_within(&mut silent, Duration::from_secs(3)).await);
        assert!(closes_within(&mut silent, Duration::from_secs(3)).await);
        tokio::time::sleep(Duration::from_millis(100)).await;
        let _after = client(capped, LINE).await;
        accepted(&mut seen).await;
    }

    #[tokio::test]
    async fn fr_mail_037_c4() {
        let (url, mut seen) = fake_worker().await;
        let (address, _) = bridge(&url, &[], None).await;
        let _tcp = client(address, LINE).await;
        let (_ws, headers) = accepted(&mut seen).await;
        assert_eq!(headers["authorization"], format!("Bearer {SECRET}"));
    }

    #[tokio::test]
    async fn fr_mail_037_c5() {
        let (url, mut seen) = fake_worker().await;
        let (address, _) = bridge(&url, &[], None).await;

        // A client close, its last bytes arriving first.
        let mut tcp = client(address, LINE).await;
        let (mut ws, _) = accepted(&mut seen).await;
        tcp.write_all(b"a1 LOGOUT\r\n").await.unwrap();
        drop(tcp);
        assert_eq!(worker_reads(&mut ws, 11).await, b"a1 LOGOUT\r\n");
        worker_sees_close(&mut ws).await;

        // A Worker close.
        let mut tcp = client(address, LINE).await;
        let (mut ws, _) = accepted(&mut seen).await;
        ws.close(None).await.unwrap();
        assert!(closes_within(&mut tcp, PATIENCE).await);

        // A reply followed by a close: the reply's bytes arrive first.
        let reply = pattern(3 * MAX_FRAME, 3);
        let mut tcp = client(address, LINE).await;
        let (mut ws, _) = accepted(&mut seen).await;
        // Together: 3 MiB can outrun the socket buffers, so writing it all first could hang.
        let worker_replies = async {
            for frame in reply.chunks(MAX_FRAME) {
                ws.send(Message::binary(frame.to_vec())).await.unwrap();
            }
            ws.close(None).await.unwrap();
        };
        let mut got = Vec::new();
        let (read, ()) = timeout(
            Duration::from_secs(30),
            futures_util::future::join(tcp.read_to_end(&mut got), worker_replies),
        )
        .await
        .unwrap();
        read.unwrap();
        assert!(got == reply, "the reply differs");
    }

    #[tokio::test]
    async fn fr_mail_037_c6() {
        let (url, mut seen) = fake_worker().await;
        let (address, _) = bridge(&url, &[], None).await;
        let mut tcp = client(address, LINE).await;
        let (mut ws, _) = accepted(&mut seen).await;
        ws.send(Message::text("no")).await.unwrap();
        assert!(closes_within(&mut tcp, PATIENCE).await);
        worker_sees_close(&mut ws).await;
    }

    #[tokio::test]
    async fn fr_mail_037_c7() {
        assert_eq!(PING_EVERY, Duration::from_secs(30));
        let (url, mut seen) = fake_worker().await;
        let shortened = Some(Duration::from_millis(50));
        let (address, _) = bridge(&url, &[], shortened).await;
        let mut tcp = client(address, LINE).await;
        let (mut ws, _) = accepted(&mut seen).await;
        for _ in 0..2 {
            let message = timeout(PATIENCE, ws.next())
                .await
                .unwrap()
                .unwrap()
                .unwrap();
            assert!(matches!(message, Message::Ping(_)), "got {message:?}");
        }
        tcp.write_all(b"still open").await.unwrap();
        assert_eq!(worker_reads(&mut ws, 10).await, b"still open");
    }

    #[tokio::test]
    async fn fr_mail_037_c8() {
        let (url, mut seen) = fake_worker().await;

        // Past MAX_CONNECTIONS, then one closing opens a slot.
        let (address, _) = bridge(&url, &[("MAX_CONNECTIONS", "2")], None).await;
        let first = client(address, LINE).await;
        let _w1 = accepted(&mut seen).await;
        let _second = client(address, LINE).await;
        let _w2 = accepted(&mut seen).await;
        let mut excess = client(address, LINE).await;
        assert!(closes_within(&mut excess, PATIENCE).await);
        drop(first);
        tokio::time::sleep(Duration::from_millis(200)).await;
        let _third = client(address, LINE).await;
        let _w3 = accepted(&mut seen).await;

        // Past MAX_PER_ADDRESS, counting one /64 as one address, then one closing opens a slot.
        let (address, _) = bridge(&url, &[("MAX_PER_ADDRESS", "1")], None).await;
        let first_in_64 = b"PROXY TCP6 2001:db8:1:2::a 2001:db8::1 5000 993\r\n";
        let second_in_64 = b"PROXY TCP6 2001:db8:1:2::b 2001:db8::1 5000 993\r\n";
        let held = client(address, first_in_64).await;
        let _w4 = accepted(&mut seen).await;
        let mut excess = client(address, second_in_64).await;
        assert!(closes_within(&mut excess, PATIENCE).await);
        let _other = client(address, LINE).await;
        let _w5 = accepted(&mut seen).await;
        drop(held);
        tokio::time::sleep(Duration::from_millis(200)).await;
        let _back = client(address, second_in_64).await;
        let _w6 = accepted(&mut seen).await;
    }

    #[tokio::test]
    async fn fr_mail_037_c9() {
        // Refusing: closes at once.
        let free = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("ws://{}/imap", free.local_addr().unwrap());
        drop(free);
        let (address, _) = bridge(&url, &[], None).await;
        let mut tcp = client(address, LINE).await;
        assert!(closes_within(&mut tcp, Duration::from_secs(1)).await);

        // Never answering: the 10-second bound.
        let mute = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("ws://{}/imap", mute.local_addr().unwrap());
        let (address, _) = bridge(&url, &[], None).await;
        let mut tcp = client(address, LINE).await;
        assert!(!closes_within(&mut tcp, Duration::from_secs(9)).await);
        assert!(closes_within(&mut tcp, Duration::from_secs(3)).await);
    }

    #[test]
    fn fr_mail_037_c10() {
        let read = |target: Option<&str>, secret: Option<&str>| {
            settings(|name| match name {
                "TARGET_URL" => target.map(str::to_owned),
                "BRIDGE_SECRET" => secret.map(str::to_owned),
                _ => None,
            })
        };
        let refused = |target, secret| read(target, secret).err().unwrap();
        assert!(refused(None, Some("s")).contains("TARGET_URL"));
        assert!(refused(Some("wss://w.example/imap"), None).contains("BRIDGE_SECRET"));
        assert!(refused(Some("wss://w.example/imap"), Some("")).contains("BRIDGE_SECRET"));
        assert!(refused(Some("ws://w.example/imap"), Some("s")).contains("TARGET_URL"));
        assert!(refused(Some("ws://127.0.0.1@w.example/"), Some("s")).contains("TARGET_URL"));
        assert!(refused(Some("ws://localhost.w.example/"), Some("s")).contains("TARGET_URL"));
        assert!(refused(Some("http://localhost/"), Some("s")).contains("TARGET_URL"));

        for accepted in [
            "wss://w.example/imap",
            "ws://127.0.0.1:8787/imap",
            "ws://localhost:8787/imap",
            "ws://[::1]:8787/imap",
        ] {
            assert!(read(Some(accepted), Some("s")).is_ok(), "{accepted}");
        }

        let defaults = read(Some("wss://w.example/imap"), Some("s")).ok().unwrap();
        assert_eq!(defaults.port, 1143);
        assert_eq!(defaults.max_connections, 256);
        assert_eq!(defaults.max_per_address, 16);

        let bad_cap = settings(|name| match name {
            "TARGET_URL" => Some("wss://w.example/imap".to_owned()),
            "BRIDGE_SECRET" => Some("s".to_owned()),
            "MAX_CONNECTIONS" => Some("many".to_owned()),
            _ => None,
        });
        assert!(bad_cap.err().unwrap().contains("MAX_CONNECTIONS"));
    }

    #[tokio::test]
    async fn fr_mail_037_c11() {
        let (url, mut seen) = fake_worker().await;
        let (address, lines) = bridge(&url, &[], None).await;

        let command = b"a1 LOGIN me hunter2\r\n";
        let mut tcp = client(address, LINE).await;
        let (mut ws, _) = accepted(&mut seen).await;
        tcp.write_all(command).await.unwrap();
        assert_eq!(worker_reads(&mut ws, command.len()).await, command);
        ws.send(Message::binary(b"a1 OK hunter3\r\n".to_vec()))
            .await
            .unwrap();
        let mut reply = [0u8; 15];
        tcp.read_exact(&mut reply).await.unwrap();
        drop(tcp);
        worker_sees_close(&mut ws).await;

        // A connection with no line logs too.
        let mut none = client(address, b"a2 LOGIN me hunter4\r\n").await;
        assert!(closes_within(&mut none, PATIENCE).await);

        timeout(PATIENCE, async {
            while lines.lock().unwrap().len() < 2 {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        let log = lines.lock().unwrap().clone();
        assert_eq!(log.len(), 2, "one line per connection: {log:?}");
        for line in &log {
            assert!(!line.contains("hunter"), "octets in the log: {line}");
            assert!(!line.contains("LOGIN"), "octets in the log: {line}");
            assert!(!line.contains(SECRET), "the secret in the log: {line}");
        }
    }
}
