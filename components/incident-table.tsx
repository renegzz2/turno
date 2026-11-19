import { CancelIncidentButton } from "./personnel-actions";
import { incidentNames, type Incident } from "@/lib/models";
import { formatDate } from "@/lib/periods";

export function IncidentTable({ rows, editable }: { rows: Incident[]; editable?: boolean }) {
  if (!rows.length) return <div className="empty">{editable ? "Todavía no hay incidencias registradas." : "Sin incidencias en este corte."}</div>;
  return <div className="table-scroll"><table>
    <thead><tr><th>Trabajador</th><th>Tipo</th><th>Desde</th><th>Hasta</th>{editable && <th>Acciones</th>}</tr></thead>
    <tbody>{rows.map((row) => <tr key={row.id}>
      <td><strong>{row.name}</strong><small>Empleado {row.code}</small></td>
      <td><span className={`status incident-${row.kind}`}>{incidentNames[row.kind]}</span></td>
      <td>{formatDate(row.starts_on)}</td><td>{formatDate(row.ends_on)}</td>
      {editable && <td><CancelIncidentButton id={row.id} name={row.name}/></td>}
    </tr>)}</tbody>
  </table></div>;
}
