/** v3.9.3 – Be / ki kapcsoló gomb (szerver űrlap, JS nélkül is működik). */
export function SummarySwitch(props: { on: boolean; what: string; action: (fd: FormData) => Promise<void>; cid?: number; label?: string; disabled?: boolean }) {
  return (
    <form action={props.action} className="sw-form">
      {props.cid !== undefined && <input type="hidden" name="cid" value={props.cid} />}
      <input type="hidden" name="what" value={props.what} />
      <input type="hidden" name="on" value={props.on ? "0" : "1"} />
      <button className={`sw${props.on ? " on" : ""}`} role="switch" aria-checked={props.on} disabled={props.disabled} title={props.on ? "Kattints a kikapcsoláshoz" : "Kattints a bekapcsoláshoz"}>
        <span className="sw-knob" aria-hidden="true" />
        <span>{props.label ?? (props.on ? "Bekapcsolva" : "Kikapcsolva")}</span>
      </button>
    </form>
  );
}
