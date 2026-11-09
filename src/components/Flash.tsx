export function Flash({ error, ok }: { error?: string | string[]; ok?: string | string[] }) {
  const e = Array.isArray(error) ? error[0] : error;
  const o = Array.isArray(ok) ? ok[0] : ok;
  return (
    <>
      {e ? <div className="flash error">{e}</div> : null}
      {o ? <div className="flash ok">{o}</div> : null}
    </>
  );
}
