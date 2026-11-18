import { useId } from 'react';
import { Star, Ellipsis } from 'lucide-react';
import { Doc, Kind, editTime, fileName } from '../types';
export function Brand({ small = false }: { small?: boolean }) {
  return (
    <div className={`brand ${small ? 'small' : ''}`}>
      <svg width="37" height="39" viewBox="0 0 40 42" fill="none" aria-hidden="true">
        <path d="M5 27.3 19 34.8 35 26.2V32l-16 8.4L5 33.1z" fill="var(--brand-dark)" />
        <path d="m5 18.2 14 7.5 16-8.6v6l-16 8.5-14-7.5z" fill="var(--accent)" />
        <path d="m5 13.2 16.2-8.7L35 12l-16 8.7z" fill="var(--brand-light)" />
        <path d="M5 13.2 19 20.7V27L5 19.3z" fill="var(--brand-dark)" />
        <path d="m19 20.7 16-8.7v6.2L19 27z" fill="var(--accent)" />
        <path
          d="m10.2 13.2 11-5.8 8.4 4.6-11 5.9z"
          fill="none"
          stroke="white"
          strokeWidth="1.25"
          opacity=".85"
        />
      </svg>
      {!small && (
        <span>
          Ft PDF<span className="brand-period">.</span>
        </span>
      )}
    </div>
  );
}
export function FileIcon({ type, small = false }: { type: Kind; small?: boolean }) {
  return (
    <span className={`file-icon ${type} ${small ? 'small' : ''}`} aria-hidden="true">
      <svg viewBox="0 0 28 32" fill="none">
        <path
          d="M5 2.5h12L23.5 9v19.3a1.7 1.7 0 0 1-1.7 1.7H5a1.7 1.7 0 0 1-1.7-1.7V4.2A1.7 1.7 0 0 1 5 2.5Z"
          fill="currentColor"
          fillOpacity=".04"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <path d="M16.8 2.8V9H23" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        {type === 'docx' ? (
          <>
            <path
              d="M8 14h11M8 17.7h11M8 21.4h7"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </>
        ) : type === 'txt' ? (
          <>
            <path
              d="M8 14h11m-5.5 0v10m-3 0h6"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </>
        ) : (
          <text
            x="13.5"
            y="22.5"
            fill="currentColor"
            textAnchor="middle"
            fontSize={type === 'html' ? '9.8' : '8.8'}
            fontWeight="800"
            fontFamily="Arial,sans-serif"
          >
            {type === 'html' ? '‹/›' : 'PDF'}
          </text>
        )}
      </svg>
    </span>
  );
}
export function PaperArt({ type = 'pdf' }: { type?: Kind }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg className="hero-art" viewBox="0 0 445 214" aria-hidden="true" fill="none">
      <defs>
        <pattern
          id={`grid${id}`}
          width="22"
          height="22"
          patternUnits="userSpaceOnUse"
          patternTransform="skewX(-20) rotate(-10)"
        >
          <path d="M22 0H0v22" stroke="white" strokeWidth=".8" opacity=".16" />
        </pattern>
        <linearGradient id={`fade${id}`}>
          <stop stopColor="black" />
          <stop offset=".35" stopColor="white" />
        </linearGradient>
        <mask id={`mask${id}`}>
          <rect width="445" height="214" fill={`url(#fade${id})`} />
        </mask>
        <linearGradient id={`paper${id}`} x1="0" x2="1" y1="1" y2="0">
          <stop stopColor="#f3d9c0" />
          <stop offset=".48" stopColor="#fff1de" />
          <stop offset="1" stopColor="#fff7e9" />
        </linearGradient>
        <filter id={`shadow${id}`} x="-40%" y="-40%" width="190%" height="210%">
          <feGaussianBlur stdDeviation="8" />
        </filter>
      </defs>
      <rect width="445" height="214" mask={`url(#mask${id})`} fill={`url(#grid${id})`} />
      <g stroke="#f3c8ad" opacity=".58" strokeWidth="1.1">
        <path d="M52 45h8m-4-4v8m315 128h8m-4-4v8m18-157h7m-3.5-3.5v7M113 188h7m-3.5-3.5v7" />
      </g>
      <ellipse
        cx="240"
        cy="142"
        rx="149"
        ry="37"
        fill="#542419"
        opacity=".34"
        filter={`url(#shadow${id})`}
      />
      <g transform="matrix(.91,-.242,.72,.55,83,65)">
        <g stroke="#8b4933" strokeWidth="1.4" strokeLinejoin="round">
          <path d="M-6 63 174 59l36 37 2 148-218 2z" fill="#c48261" />
          <path d="m-6 58 179-2 37 39 2 144-218 2z" fill="#dfad8b" />
          <path d="m-9 47 184-1 34 39 1 140-217 5z" fill="#f7d3b3" />
          <path d="m-10 42 184-1 35 39 1 140-217 5z" fill="#f9e1c7" />
          <path d="M0 30h168l42 40v142H0z" fill="#d2926d" />
          <path d="M0 25h168l42 40v143H0z" fill="#efc6a1" />
          <path d="M-5 15h169l41 40v142H-5z" fill="#fcdfc4" />
          <path d="M-5 12h169l41 40v142H-5z" fill="#ffecd7" />
          <path d="M0 4h165l46 43v140H0z" fill="#deb28b" />
          <path d="M0 0h165l46 43v140H0z" fill={`url(#paper${id})`} />
        </g>
        <path
          d="m165 0 46 43h-46z"
          fill="#ddaf8f"
          stroke="#9f6953"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
        <path d="M19 18h11v11H19z" fill="#ab4834" />
        <path d="M35 21h43m-43 5h30" stroke="#bd8e73" strokeWidth="2.4" />
        <path d="M19 46h104m-104 9h72" stroke="#9c6750" strokeWidth="4.2" />
        <path d="M19 71h122m-122 6h99m-99 6h108" stroke="#ccab91" strokeWidth="2.5" />
        <g transform="translate(17 109)">
          <rect width="73" height="47" rx="3" fill="#ae4936" />
          <text
            x="36.4"
            y="32"
            textAnchor="middle"
            fontFamily="Arial, sans-serif"
            fontWeight="bold"
            fontSize={type === 'docx' ? 20 : 27}
            letterSpacing="-1.5"
            fill="#fff2df"
          >
            {type.toUpperCase()}
          </text>
        </g>
        <g stroke="#bc8063" strokeWidth="2.3">
          <path d="M115 154v-44c0-18 15-32 33-32s33 14 33 32v44z" />
          <path d="M121 154v-44c0-14 12-26 27-26s27 12 27 26v44m-48 0v-44c0-11 9-20 21-20s21 9 21 20v44m-36 0v-44c0-8 7-14 15-14s15 6 15 14v44m-24 0v-44a9 9 0 0 1 18 0v44" />
        </g>
        <path d="M19 168h175" stroke="#b8997c" strokeWidth="1.2" />
      </g>
    </svg>
  );
}
export function Cover({ d }: { d: Doc }) {
  return (
    <div className={`cover art-${d.cover}`} aria-hidden="true">
      <div className="art-texture" />
      {d.cover === 'code' ? (
        <div className="code-paper">
          <div className="code-bar">
            <i />
            <i />
            <i />
            <span>index.html</span>
          </div>
          <div className="code-lines">
            <div>
              <b>&lt;!DOCTYPE</b> <em>html</em>
              <b>&gt;</b>
            </div>
            <div>
              <b>&lt;html</b> <strong>lang</strong>=<em>"en"</em>
              <b>&gt;</b>
            </div>
            <div>
              &nbsp; <b>&lt;head&gt;</b>
            </div>
            <div>
              &nbsp;&nbsp;&nbsp; <b>&lt;title&gt;</b>Portfolio<b>&lt;/title&gt;</b>
            </div>
            <div>
              &nbsp; <b>&lt;/head&gt;</b>
            </div>
            <div>
              &nbsp; <b>&lt;body&gt;</b>
            </div>
          </div>
        </div>
      ) : d.cover === 'proposal' ? (
        <div className="proposal-paper">
          <div className="microhead">
            <span className="mini-mark" /> NORTH STUDIO <span>№ 02</span>
          </div>
          <div className="prop-rule" />
          <div className="paper-title">
            {d.name === 'Project proposal' ? 'Project proposal' : d.name}
          </div>
          <div className="paper-sub">PROJECT OVERVIEW</div>
          <div className="paper-lines">
            <i />
            <i />
            <i />
          </div>
        </div>
      ) : d.cover === 'note' ? (
        <div className="note-paper">
          <div className="microhead">
            FIELD NOTES <span>✳</span>
          </div>
          <div className="paper-title">{d.name}</div>
          <div className="paper-lines">
            <i />
            <i />
            <i />
          </div>
        </div>
      ) : (
        <div className="report-paper">
          <div className="microhead">
            <span>FIELDNOTES</span>
            <span>REPORT SERIES / 04</span>
          </div>
          <div className="report-title">
            {d.name === 'Quarterly report' ? (
              <>
                Quarterly
                <br />
                report<span>.</span>
              </>
            ) : (
              d.name
            )}
          </div>
          <div className="chart">
            {[29, 45, 39, 62, 76, 66, 96].map((h, i) => (
              <i key={i} style={{ height: h + '%' }} />
            ))}
          </div>
          <span className="report-foot">STRATEGY & INSIGHTS</span>
        </div>
      )}
    </div>
  );
}
export function DocCard({
  d,
  open,
  star,
  menu,
}: {
  d: Doc;
  open: (d: Doc) => void;
  star: (d: Doc) => void;
  menu: (d: Doc, e: React.MouseEvent) => void;
}) {
  return (
    <article className="doc-card">
      <button className="card-open" aria-label={`Open ${fileName(d)}`} onClick={() => open(d)}>
        <Cover d={d} />
        <div className="card-info">
          <FileIcon type={d.type} />
          <div>
            <h3>{fileName(d)}</h3>
            <p>{editTime(d.updated)}</p>
          </div>
        </div>
      </button>
      <button
        className={`card-star ${d.starred ? 'on' : ''}`}
        title={d.starred ? 'Remove from starred' : 'Star document'}
        aria-label={`${d.starred ? 'Unstar' : 'Star'} ${d.name}`}
        onClick={() => star(d)}
      >
        <Star size={15} fill={d.starred ? 'currentColor' : 'none'} />
      </button>
      <button
        className="card-menu icon-btn"
        aria-label={`Actions for ${d.name}`}
        onClick={(e) => menu(d, e)}
      >
        <Ellipsis size={17} />
      </button>
    </article>
  );
}
