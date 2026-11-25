// =========================================================
// ADMIN UI KIT
// =========================================================
//
// Small presentational components for the embedded admin
// pages, styled by app/styles/admin-ui.css (loaded in
// routes/app.jsx). They hold no data or business logic: pages
// keep their own loaders, actions, fetchers and state and only
// use these for the look.
// =========================================================

/* eslint-disable react/prop-types */
import { Link } from "react-router";

const cx = (...names) => names.filter(Boolean).join(" ");

// ---------- Icons (inline, decorative) ----------

const ICON_PATHS = {
  back: <path d="M19 12H5M11 18l-6-6 6-6" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </>
  ),
  sync: (
    <>
      <path d="M20 11a8 8 0 0 0-14.3-4.9L4 8" />
      <path d="M4 4v4h4" />
      <path d="M4 13a8 8 0 0 0 14.3 4.9L20 16" />
      <path d="M20 20v-4h-4" />
    </>
  ),
  sparkle: (
    <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z" />
  ),
  box: (
    <>
      <path d="M3 8l9-5 9 5-9 5-9-5z" />
      <path d="M3 8v8l9 5 9-5V8" />
      <path d="M12 13v8" />
    </>
  ),
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  target: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3.5" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  play: <path d="M7 5l12 7-12 7V5z" fill="currentColor" stroke="none" />,
  list: <path d="M5 7h14M5 12h10M5 17h7" />,
  plus: <path d="M12 5v14M5 12h14" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5M12 8h.01" />
    </>
  ),
  alert: (
    <>
      <path d="M12 4l9 16H3l9-16z" />
      <path d="M12 10v4M12 17h.01" />
    </>
  ),
  arrowRight: <path d="M5 12h14M13 6l6 6-6 6" />,
  arrowUp: <path d="M12 19V5M6 11l6-6 6 6" />,
  trash: <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />,
  arrowDown: <path d="M12 5v14M6 13l6 6 6-6" />,
  eyeOff: (
    <>
      <path d="M3 3l18 18" />
      <path d="M10.6 6.1A9.8 9.8 0 0 1 12 6c5 0 8.5 4.5 9.5 6a17 17 0 0 1-2.6 3.2M6.6 7.6C4.6 9 3.2 10.9 2.5 12c1 1.5 4.5 6 9.5 6 1.6 0 3-.4 4.3-1.1" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </>
  ),
  chat: <path d="M4 5h16v11H9l-5 4V5z" />,
  cpu: (
    <>
      <rect x="6" y="6" width="12" height="12" rx="2" />
      <path d="M10 10h4v4h-4zM9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3" />
    </>
  ),
  store: (
    <>
      <path d="M4 9l1.5-5h13L20 9" />
      <path d="M4 9h16v2a3 3 0 0 1-5.3 1.9A3 3 0 0 1 12 14a3 3 0 0 1-2.7-1.1A3 3 0 0 1 4 11V9z" />
      <path d="M5.5 13.5V20h13v-6.5" />
    </>
  ),
  bolt: <path d="M13 3L5 13.5h6L10 21l8-10.5h-6L13 3z" />,
  book: (
    <>
      <path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5V4.5z" />
      <path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H19" />
    </>
  ),
  question: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5V14M12 17h.01" />
    </>
  )
};

export function Icon({ name, size = 18, strokeWidth = 1.8 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {ICON_PATHS[name]}
    </svg>
  );
}

// ---------- Layout ----------

export function Page({ narrow = false, children }) {
  return (
    <div className="ui-page">
      <div className={cx("ui-container", narrow && "ui-container--narrow")}>
        {children}
      </div>
    </div>
  );
}

/*
 * Page header. `backTo` shows the back button, `eyebrow` the
 * small line above the title, `actions` the buttons on the right.
 */
export function PageHeader({
  title,
  eyebrow,
  eyebrowAccent = false,
  subtitle,
  backTo,
  actions,
  large = false
}) {
  return (
    <header className="ui-header">
      <div className="ui-header__main">
        {backTo && (
          <Link to={backTo} className="ui-back" aria-label="Back">
            <Icon name="back" size={18} strokeWidth={2} />
          </Link>
        )}
        <div>
          {eyebrow && (
            <p className={cx("ui-eyebrow", eyebrowAccent && "ui-eyebrow--accent")}>
              {eyebrow}
            </p>
          )}
          <h1 className={cx("ui-title", large && "ui-title--xl")}>{title}</h1>
          {subtitle && <p className="ui-subtitle">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="ui-header__actions">{actions}</div>}
    </header>
  );
}

export function Card({
  title,
  description,
  icon,
  aside,
  variant,
  className,
  children
}) {
  const hasHead = title || description || icon || aside;

  return (
    <section className={cx("ui-card", variant && `ui-card--${variant}`, className)}>
      {hasHead && (
        <div className="ui-card__head" style={children ? undefined : { marginBottom: 0 }}>
          <div className="ui-card__head-main">
            {icon && (
              <span className="ui-icon-tile">
                <Icon name={icon} size={16} />
              </span>
            )}
            <div>
              {title && <h2 className="ui-card__title">{title}</h2>}
              {description && <p className="ui-card__desc">{description}</p>}
            </div>
          </div>
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}

// ---------- Buttons ----------

/*
 * variant: primary (purple) | dark | secondary | outline-accent
 * Renders an <a> when `href` is given.
 */
export function Button({
  variant = "secondary",
  size,
  icon,
  loading = false,
  disabled = false,
  href,
  target,
  onClick,
  type = "button",
  className: extraClassName,
  children,
  ...rest
}) {
  const className = cx(
    "ui-btn",
    `ui-btn--${variant}`,
    size && `ui-btn--${size}`,
    extraClassName
  );
  const content = (
    <>
      {loading ? <span className="ui-spinner" aria-hidden="true" /> : icon && <Icon name={icon} size={14} />}
      {children}
    </>
  );

  if (href) {
    return (
      <a className={className} href={href} target={target} {...rest}>
        {content}
      </a>
    );
  }

  return (
    <button
      type={type}
      className={className}
      onClick={onClick}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {content}
    </button>
  );
}

export function LinkButton({ tone, children, ...rest }) {
  return (
    <button type="button" className={cx("ui-link-btn", tone && `ui-link-btn--${tone}`)} {...rest}>
      {children}
    </button>
  );
}

export function Spinner({ label = "Loading" }) {
  return <span className="ui-spinner ui-spinner--accent" role="status" aria-label={label} />;
}

// ---------- Form controls ----------

export function TextField({
  id,
  label,
  labelMuted = false,
  value,
  onChange,
  placeholder,
  maxLength,
  showCount = false,
  error,
  help,
  icon,
  type = "text",
  onKeyDown,
  ...rest
}) {
  const count = showCount && maxLength ? `${String(value || "").length}/${maxLength}` : null;

  return (
    <div className="ui-field">
      {label && (
        <label htmlFor={id} className={cx("ui-label", labelMuted && "ui-label--muted")}>
          {label}
        </label>
      )}
      <div className="ui-input-wrap">
        {icon && (
          <span className="ui-input-icon">
            <Icon name={icon} size={15} />
          </span>
        )}
        <input
          id={id}
          type={type}
          className={cx(
            "ui-input",
            icon && "ui-input--with-icon",
            count && "ui-input--with-count",
            error && "ui-input--invalid"
          )}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          maxLength={maxLength}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : help ? `${id}-help` : undefined}
          {...rest}
        />
        {count && <span className="ui-input-count">{count}</span>}
      </div>
      {error && (
        <p id={`${id}-error`} className="ui-field-error">
          {error}
        </p>
      )}
      {!error && help && (
        <p id={`${id}-help`} className="ui-help">
          {help}
        </p>
      )}
    </div>
  );
}

/*
 * Radio options shown as selectable cards.
 * options: [{ value, label, description }]
 */
export function ChoiceCards({ name, label, options, value, onChange }) {
  return (
    <fieldset className="ui-field" style={{ border: 0, margin: 0, padding: 0 }}>
      {label && <legend className="ui-label" style={{ marginBottom: 8 }}>{label}</legend>}
      <div className="ui-choice-grid">
        {options.map((option) => {
          const checked = option.value === value;

          return (
            <label key={option.value} className={cx("ui-choice", checked && "ui-choice--checked")}>
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={checked}
                onChange={() => onChange(option.value)}
              />
              <span className="ui-choice__dot" aria-hidden="true" />
              <span>
                <span className="ui-choice__title">{option.label}</span>
                {option.description && (
                  <span className="ui-choice__desc">{option.description}</span>
                )}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export function Switch({ label, description, checked, onChange }) {
  return (
    <label className="ui-switch">
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="ui-switch__track" aria-hidden="true" />
      <span>
        <span className="ui-switch__label">{label}</span>
        {description && <span className="ui-switch__desc">{description}</span>}
      </span>
    </label>
  );
}

export function Checkbox({ label, checked, onChange, ariaLabel }) {
  return (
    <label className="ui-check">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        aria-label={ariaLabel}
      />
      {label}
    </label>
  );
}

// ---------- Feedback ----------

const BANNER_ICONS = {
  success: "check",
  critical: "alert",
  warning: "alert",
  info: "info"
};

export function Banner({ tone = "info", children }) {
  return (
    <div
      className={`ui-banner ui-banner--${tone}`}
      role={tone === "critical" ? "alert" : "status"}
    >
      <span className="ui-banner__icon">
        <Icon name={BANNER_ICONS[tone]} size={16} />
      </span>
      <div className="ui-banner__body">{children}</div>
    </div>
  );
}

export function Badge({ tone, dot = false, children }) {
  return (
    <span className={cx("ui-badge", tone && `ui-badge--${tone}`)}>
      {dot && <span className="ui-dot" aria-hidden="true" />}
      {children}
    </span>
  );
}

export function EmptyState({ icon = "list", children }) {
  return (
    <div className="ui-empty">
      <span className="ui-empty__icon">
        <Icon name={icon} size={16} />
      </span>
      <div>{children}</div>
    </div>
  );
}

// ---------- Dashboard ----------

export function StatCard({ label, icon, iconTone, value, valueSize, foot, children }) {
  return (
    <div className="ui-stat">
      <div className="ui-stat__head">
        <span className="ui-stat__label">{label}</span>
        {icon && (
          <span className={cx("ui-stat__icon", iconTone && `ui-stat__icon--${iconTone}`)}>
            <Icon name={icon} size={13} />
          </span>
        )}
      </div>
      {value !== undefined && (
        <div className={cx("ui-stat__value", valueSize === "md" && "ui-stat__value--md")}>
          {value}
        </div>
      )}
      {children}
      {foot && <div className="ui-stat__foot">{foot}</div>}
    </div>
  );
}

// ---------- Products ----------

export function initials(text) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean);

  return (words[0]?.[0] || "?").toUpperCase() + (words[1]?.[0] || "").toUpperCase();
}

export function ProductMedia({ image, title }) {
  return (
    <div className={cx("ui-product__media", image && "ui-product__media--img")}>
      {image ? <img src={image} alt={title || ""} loading="lazy" /> : title || "No image"}
    </div>
  );
}
/* eslint-enable react/prop-types */
