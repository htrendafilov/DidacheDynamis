import { Fragment, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import type { Document, DocumentBlock } from "../data/api";

function BlockContent({ block }: { block: DocumentBlock }) {
  if (!block.runs) return block.text;
  return block.runs.map((run, index) => {
    let content: ReactNode = run.t;
    if (run.emphasis) content = <em>{content}</em>;
    if (run.strong) content = <strong>{content}</strong>;
    if (run.superscript) content = <sup className="study-verse-number">{content}</sup>;
    return <Fragment key={index}>{content}</Fragment>;
  });
}

export function DocumentRenderer({ document }: { document: Document }) {
  const { t } = useTranslation();
  const quotationIndex = document.blocks.findIndex((block) => block.kind === "quotation");
  const commentaryStart =
    quotationIndex < 0
      ? -1
      : document.blocks.findIndex(
          (block, index) => index > quotationIndex && block.kind !== "quotation",
        );

  return (
    <div className="study-document">
      {document.blocks.map((block, index) => (
        <Fragment key={index}>
          {index === commentaryStart && (
            <div className="study-section-label">{t("commentary.commentaryText")}</div>
          )}
          {block.kind === "heading" ? (
            <h4>
              <BlockContent block={block} />
            </h4>
          ) : block.kind === "quotation" ? (
            <blockquote className="study-quotation">
              <span className="study-quotation-label">{t("commentary.quotedKjv")}</span>
              <p>
                <BlockContent block={block} />
              </p>
            </blockquote>
          ) : (
            <p>
              <BlockContent block={block} />
            </p>
          )}
        </Fragment>
      ))}
    </div>
  );
}
