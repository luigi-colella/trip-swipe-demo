import Markdown, { type Components } from "react-markdown";
import { allowedLink } from "@/lib/links";

/**
 * Assistant replies as sanitized markdown (LLM05): a few inline and list elements only, raw
 * HTML dropped, and links kept only to allow-listed sites (others become plain text).
 */

const ALLOWED_ELEMENTS = ["p", "strong", "em", "del", "ul", "ol", "li", "a", "code", "br"];

const components: Components = {
  a: ({ href, children }) => {
    const url = href ? allowedLink(href) : null;
    if (!url) return <span>{children}</span>;
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className="underline underline-offset-2"
      >
        {children}
      </a>
    );
  },
};

export function ChatMarkdown({ text }: { text: string }) {
  return (
    <div className="flex flex-col gap-2 [&_code]:font-mono [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5">
      <Markdown
        allowedElements={ALLOWED_ELEMENTS}
        unwrapDisallowed
        skipHtml
        components={components}
      >
        {text}
      </Markdown>
    </div>
  );
}
