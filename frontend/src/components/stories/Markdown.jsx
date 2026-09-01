import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

// GFM rendering (tables, task lists, strikethrough). Raw HTML in the source is
// deliberately NOT rendered — react-markdown without rehype-raw emits it as
// inert text, so script tags and inline handlers can't reach the DOM.
export default function Markdown({ children }) {
  return (
    <div className="md-body">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children || ''}</ReactMarkdown>
    </div>
  )
}
