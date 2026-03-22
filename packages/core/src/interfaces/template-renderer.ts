export interface TemplateRenderer {
  render(
    template: string,
    props: Record<string, unknown>,
  ): Promise<{ html: string; text?: string }>;
}
