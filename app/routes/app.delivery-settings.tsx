import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";
import { requireAdmin } from "../auth/admin.server";
import { getDeliverySettings, saveDeliverySettings } from "../services/delivery.server";

export async function loader({ request }: LoaderFunctionArgs) { await requireAdmin(request); return { settings: await getDeliverySettings() }; }
export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request); const f = await request.formData(); const num = (key: string) => Number(f.get(key));
  const method = String(f.get("distanceMethod") || ""); const rounding = String(f.get("kmRoundingMode") || "");
  if (!["", "STRAIGHT_LINE", "DRIVING"].includes(method) || !["", "EXACT", "CEIL", "FLOOR", "NEAREST"].includes(rounding)) return { ok: false, message: "Invalid distance configuration." };
  try { await saveDeliverySettings({ deliveryEnabled: f.get("deliveryEnabled") === "on", minDeliverySpendCents: num("minDeliverySpendCents"), distanceMethod: method ? method as "STRAIGHT_LINE" | "DRIVING" : null, kmRoundingMode: rounding ? rounding as "EXACT" | "CEIL" | "FLOOR" | "NEAREST" : null, tierUnder25Cents: num("tierUnder25Cents"), tier25To40Cents: num("tier25To40Cents"), tier40To55Cents: num("tier40To55Cents"), over55BaseCents: num("over55BaseCents"), over55PerKmCents: num("over55PerKmCents") }); return { ok: true, message: "Delivery settings saved." }; } catch { return { ok: false, message: "Invalid delivery settings." }; }
}
export default function DeliverySettings() {
  const { settings } = useLoaderData<typeof loader>(); const result = useActionData<typeof action>();
  const s = settings ?? { deliveryEnabled: true, minDeliverySpendCents: 25000, tierUnder25Cents: 5000, tier25To40Cents: 7500, tier40To55Cents: 12000, over55BaseCents: 12000, over55PerKmCents: 300, distanceMethod: null, kmRoundingMode: null };
  const fields = [["Minimum order (cents)", "minDeliverySpendCents", s.minDeliverySpendCents], ["Under 25km (cents)", "tierUnder25Cents", s.tierUnder25Cents], ["25–40km (cents)", "tier25To40Cents", s.tier25To40Cents], ["40–55km (cents)", "tier40To55Cents", s.tier40To55Cents], ["Over 55 base (cents)", "over55BaseCents", s.over55BaseCents], ["Additional km (cents)", "over55PerKmCents", s.over55PerKmCents]] as const;
  return <s-page heading="Delivery settings" inlineSize="large"><s-stack direction="block" gap="base">{result?.message ? <s-text>{result.message}</s-text> : null}<p>Currency: AUD. Private origin is server-side only and is not displayed here.</p><Form method="post"><label><input type="checkbox" name="deliveryEnabled" defaultChecked={s.deliveryEnabled} /> Delivery enabled</label>{fields.map(([label, name, value]) => <label key={name}>{label} <input name={name} type="number" min="0" defaultValue={Number(value)} /></label>)}<label>Distance method <select name="distanceMethod" defaultValue={s.distanceMethod ?? ""}><option value="">Not configured</option><option value="STRAIGHT_LINE">Straight line</option><option value="DRIVING">Driving provider</option></select></label><label>Extra-km rounding <select name="kmRoundingMode" defaultValue={s.kmRoundingMode ?? ""}><option value="">Not configured</option><option value="EXACT">Exact</option><option value="CEIL">Round up</option><option value="FLOOR">Round down</option><option value="NEAREST">Nearest</option></select></label><s-button type="submit" variant="primary">Save settings</s-button></Form></s-stack></s-page>;
}
