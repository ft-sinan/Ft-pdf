/** Opaque, script-disabled origin. A document is data, never part of the app shell. */
export function HtmlPreview({ content }: { content: string }) {
  return (
    <iframe
      className="html-preview"
      sandbox=""
      referrerPolicy="no-referrer"
      title="Safe HTML preview"
      srcDoc={`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; form-action 'none'; base-uri 'none';"><meta name="viewport" content="width=device-width, initial-scale=1">${content}`}
    />
  );
}
