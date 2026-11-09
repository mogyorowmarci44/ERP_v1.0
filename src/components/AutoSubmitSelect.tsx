"use client";

/** Választó, ami kiválasztáskor azonnal elküldi az űrlapját (JS nélkül a mellette lévő gomb működik). */
export function AutoSubmitSelect(props: { name: string; defaultValue: string; options: Array<{ value: string; label: string }>; label: string }) {
  return (
    <label>{props.label}
      <select name={props.name} defaultValue={props.defaultValue} onChange={(e) => e.currentTarget.form?.requestSubmit()}>
        {props.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}
