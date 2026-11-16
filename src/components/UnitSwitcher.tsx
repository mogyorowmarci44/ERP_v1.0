import Link from "next/link";
import { eq } from "drizzle-orm";
import { ArrowLeftRight, Check, LayoutGrid } from "lucide-react";
import { db, schema } from "@/db";
import { legalFormLabel } from "@/lib/entity";

/**
 * Oldalsáv alján: átjelentkezés a felhasználó számára elérhető bármely egységbe
 * (Bt / Kft / Zrt / Nyrt … vagy adószámos magánszemély). Szerveroldali, JS nélküli <details> lenyíló.
 */
export async function UnitSwitcher({ userId, currentId }: { userId: number; currentId: number }) {
  const list = await db
    .select({
      id: schema.companies.id,
      name: schema.companies.name,
      entityType: schema.companies.entityType,
      role: schema.memberships.role,
    })
    .from(schema.memberships)
    .innerJoin(schema.companies, eq(schema.companies.id, schema.memberships.companyId))
    .where(eq(schema.memberships.userId, userId))
    .orderBy(schema.companies.entityType, schema.companies.name);

  const others = list.filter((u) => u.id !== currentId);

  return (
    <details className="unit-switch">
      <summary>
        <ArrowLeftRight aria-hidden="true" />
        <span>Átjelentkezés másik egységbe</span>
        {others.length > 0 && <span className="count">{others.length}</span>}
      </summary>
      <div className="unit-list" role="list">
        {list.map((u) => {
          const on = u.id === currentId;
          return (
            <Link
              key={u.id}
              href={`/c/${u.id}`}
              role="listitem"
              className={on ? "unit on" : "unit"}
              aria-current={on ? "page" : undefined}
            >
              <span className="unit-name">{u.name}</span>
              <span className="unit-kind">{legalFormLabel(u)}</span>
              {on && <Check aria-hidden="true" className="tick" />}
            </Link>
          );
        })}
        <Link href="/" className="unit all">
          <LayoutGrid aria-hidden="true" />
          <span>Összes egység / új létrehozása</span>
        </Link>
      </div>
    </details>
  );
}
