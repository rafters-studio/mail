import type { TemplateRenderer } from '@rafters/mail';
import { render } from '@react-email/components';
import type { ReactElement } from 'react';

type TemplateComponent = (props: Record<string, unknown>) => ReactElement;

export interface ReactEmailRenderer extends TemplateRenderer {
  register(name: string, component: TemplateComponent): void;
}

/**
 * Create a React Email renderer that satisfies the TemplateRenderer interface.
 *
 * Optionally accepts an initial map of template name -> React component.
 * Additional templates can be registered after creation via `.register()`.
 */
export function createReactEmailRenderer(
  templates?: Record<string, TemplateComponent>,
): ReactEmailRenderer {
  const registry = new Map<string, TemplateComponent>(
    templates ? Object.entries(templates) : [],
  );

  return {
    register(name: string, component: TemplateComponent) {
      registry.set(name, component);
    },

    async render(
      template: string,
      props: Record<string, unknown>,
    ): Promise<{ html: string; text?: string }> {
      const component = registry.get(template);
      if (!component) {
        throw new Error(
          `Template "${template}" not found. Registered templates: ${[...registry.keys()].join(', ') || '(none)'}`,
        );
      }

      const element = component(props);

      const [html, text] = await Promise.all([
        render(element),
        render(element, { plainText: true }),
      ]);

      return { html, text };
    },
  };
}
