import { Fragment, useMemo } from "react";
import { useTranslation } from "react-i18next";

import { resolve, type SourceManifest } from "../../chat/citations";
import { type BlockNode, type InlineNode, parseMessage } from "../../chat/markdown";
import type { StudySource } from "../../chat/types";

// Renders an assistant answer as React elements built from parseMessage's tree — never
// dangerouslySetInnerHTML. Anything the tiny parser does not explicitly recognize (a raw
// HTML tag, a javascript: URL, a line impersonating the system role) was never turned into
// anything but a text node, so it is inert here by construction, not by filtering.
function InlineRun({
  node,
  manifest,
  onCitationClick,
}: {
  node: InlineNode;
  manifest: SourceManifest;
  onCitationClick: (source: StudySource) => void;
}) {
  const { t } = useTranslation();
  switch (node.type) {
    case "text":
      return <>{node.text}</>;
    case "bold":
      return <strong>{node.text}</strong>;
    case "italic":
      return <em>{node.text}</em>;
    case "highlight":
      return <mark className="chat-mark">{node.text}</mark>;
    case "underline":
      return <u className="chat-underline">{node.text}</u>;
    case "code":
      return <code>{node.text}</code>;
    case "citation": {
      const source = node.token.id ? resolve(node.token.id, manifest) : null;
      if (!source) {
        return (
          <span className="chat-citation-unverified" title={t("chat.unverifiedCitation")}>
            {node.token.raw}
          </span>
        );
      }
      return (
        <button
          type="button"
          className="chat-citation"
          onClick={() => onCitationClick(source)}
          aria-label={t("chat.citationLabel", { label: source.label })}
        >
          {node.token.raw}
        </button>
      );
    }
  }
}

function Inline({
  nodes,
  manifest,
  onCitationClick,
}: {
  nodes: InlineNode[];
  manifest: SourceManifest;
  onCitationClick: (source: StudySource) => void;
}) {
  return (
    <>
      {nodes.map((node, i) => (
        <Fragment key={i}>
          <InlineRun node={node} manifest={manifest} onCitationClick={onCitationClick} />
        </Fragment>
      ))}
    </>
  );
}

function Block({
  block,
  manifest,
  onCitationClick,
}: {
  block: BlockNode;
  manifest: SourceManifest;
  onCitationClick: (source: StudySource) => void;
}) {
  switch (block.type) {
    case "paragraph":
      return (
        <p>
          <Inline nodes={block.inline} manifest={manifest} onCitationClick={onCitationClick} />
        </p>
      );
    case "list": {
      const Tag = block.ordered ? "ol" : "ul";
      return (
        <Tag>
          {block.items.map((item, i) => (
            <li key={i}>
              <Inline nodes={item} manifest={manifest} onCitationClick={onCitationClick} />
            </li>
          ))}
        </Tag>
      );
    }
    case "codeBlock":
      return (
        <pre>
          <code>{block.text}</code>
        </pre>
      );
  }
}

export function ChatMessage({
  text,
  manifest,
  onCitationClick,
}: {
  text: string;
  manifest: SourceManifest;
  onCitationClick: (source: StudySource) => void;
}) {
  const blocks = useMemo(() => parseMessage(text), [text]);
  return (
    <div className="chat-message-body">
      {blocks.map((block, i) => (
        <Block key={i} block={block} manifest={manifest} onCitationClick={onCitationClick} />
      ))}
    </div>
  );
}
