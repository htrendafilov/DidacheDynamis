import { Fragment, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { DictionaryDocumentRef } from "../components/DictionaryDocumentRef";
import { ScriptureRef } from "../components/ScriptureRef";
import type { DictionaryDocumentRef as DictionaryDocumentRefTarget, Document, DocumentBlock } from "../data/api";

function BlockContent({
  block,
  onDictionaryNavigate,
}: {
  block: DocumentBlock;
  onDictionaryNavigate?: (target: DictionaryDocumentRefTarget) => void;
}) {
  if (!block.runs) return block.text;
  return block.runs.map((run, index) => {
    let content: ReactNode = run.t;
    if (run.emphasis) content = <em>{content}</em>;
    if (run.strong) content = <strong>{content}</strong>;
    if (run.superscript) content = <sup className="study-verse-number">{content}</sup>;
    if (run.ref) content = <ScriptureRef refValue={run.ref}>{content}</ScriptureRef>;
    // Without an explicit navigation callback a dictionary_ref renders as plain text —
    // never a dead button (commentary/book panes omit the callback by design).
    if (run.dictionary_ref && onDictionaryNavigate) {
      content = (
        <DictionaryDocumentRef target={run.dictionary_ref} onNavigate={onDictionaryNavigate}>
          {content}
        </DictionaryDocumentRef>
      );
    }
    return <Fragment key={index}>{content}</Fragment>;
  });
}

export function DocumentRenderer({
  document,
  onDictionaryNavigate,
}: {
  document: Document;
  onDictionaryNavigate?: (target: DictionaryDocumentRefTarget) => void;
}) {
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
              <BlockContent block={block} onDictionaryNavigate={onDictionaryNavigate} />
            </h4>
          ) : block.kind === "quotation" ? (
            <blockquote className="study-quotation">
              <span className="study-quotation-label">{t("commentary.quotedKjv")}</span>
              <p>
                <BlockContent block={block} onDictionaryNavigate={onDictionaryNavigate} />
              </p>
            </blockquote>
          ) : (
            <p>
              <BlockContent block={block} onDictionaryNavigate={onDictionaryNavigate} />
            </p>
          )}
        </Fragment>
      ))}
    </div>
  );
}
