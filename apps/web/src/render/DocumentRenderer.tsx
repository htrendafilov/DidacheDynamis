import type { Document } from "../data/api";

export function DocumentRenderer({ document }: { document: Document }) {
  return (
    <div className="study-document">
      {document.blocks.map((block, index) =>
        block.kind === "heading" ? (
          <h4 key={index}>{block.text}</h4>
        ) : (
          <p key={index}>{block.text}</p>
        ),
      )}
    </div>
  );
}
