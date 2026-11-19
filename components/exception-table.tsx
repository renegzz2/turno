import { JustifyAbsenceButton } from "./personnel-actions";
import { formatDate } from "@/lib/periods";
import { exceptionNames, type Exception } from "@/lib/schedules";

export function ExceptionTable({ rows }: { rows: Exception[] }) {
  return <section className="card register-card exception-panel" aria-labelledby="exceptions-title">
    <div className="records-heading"><div><h2 id="exceptions-title">Retardos y faltas</h2>
      <p>Se calculan con el horario de cada trabajador. Las faltas se detectan al terminar el turno.</p></div></div>
    {rows.length ? <div className="table-scroll"><table>
      <thead><tr><th>Trabajador</th><th>Día del turno</th><th>Entrada prevista</th><th>Primera entrada</th><th>Resultado</th><th>Acciones</th></tr></thead>
      <tbody>{rows.map((row) => <tr key={`${row.employeeId}/${row.day}`}>
        <td><strong>{row.name}</strong><small>Empleado {row.code}</small></td>
        <td>{formatDate(row.day)}</td><td>{row.expected}</td><td>{row.actual ?? "—"}</td>
        <td><span className={`status ${row.kind === "late" ? "pending" : row.kind === "absent" ? "incident-unjustified" : "incident-justified"}`}>{exceptionNames[row.kind]}</span>
          {row.minutes !== null && <small>{row.minutes} min después de la hora prevista</small>}</td>
        <td>{row.kind === "absent" && <JustifyAbsenceButton id={row.employeeId} day={row.day} name={row.name}/>}</td>
      </tr>)}</tbody>
    </table></div> : <div className="empty">Sin retardos ni faltas detectados en este corte.</div>}
  </section>;
}
