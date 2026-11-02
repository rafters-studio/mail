FROM rust:1-slim-bookworm AS build
WORKDIR /bridge
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo build --release --locked

# The CA roots are compiled in (rustls-tls-webpki-roots), so the image needs no CA bundle.
FROM gcr.io/distroless/cc-debian12:nonroot
COPY --from=build /bridge/target/release/bridge /bridge
ENTRYPOINT ["/bridge"]
