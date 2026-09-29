// Advisor: evaluates the city once a day and posts the most urgent piece of
// advice (with per-topic cooldowns so it never nags), plus hints about what
// to build next and what a new milestone unlocked.
import { Problem, type Building, type BuildingCategory, type BuildingDef } from '../core/types';
import { formatMoney, formatPercent } from '../core/util';
import { MILESTONES } from '../data/milestones';
import { POLICIES } from '../data/policies';
import type { SimContext } from './context';
import { cheapestUnlocked, unlockedAt } from './catalog';
import { LevelBlock } from './lifecycle';
import { ADVISOR_INFO_EXTRA_GAP, ADVISOR_MIN_GAP, ADVISOR_URGENT_GAP } from './tuning';

export interface AdvisorTip {
  key: string;
  kind: 'info' | 'warning' | 'danger' | 'good';
  title: string;
  text: string;
  icon: string;
  priority: number;
  /** days before the same tip may repeat */
  cooldown: number;
  target?: Building;
  x?: number;
  y?: number;
}

export class Advisor {
  constructor(private ctx: SimContext) {}

  daily(): void {
    const ctx = this.ctx, st = ctx.state.advisor, day = ctx.day;
    if (ctx.fastForward || !ctx.settings.gameplay.advisor || !ctx.lastValid) return;
    // urgent problems may cut in line (but never right after another notice)
    if (day < st.next && day < (st.last ?? -99) + ADVISOR_URGENT_GAP) return;
    const tips = this.evaluate().filter((t) => (st.cd[t.key] ?? -1) <= day);
    if (!tips.length) return;
    tips.sort((a, b) => b.priority - a.priority);
    const t = tips[0];
    if (day < st.next && t.kind !== 'danger') return;
    const target = t.target;
    ctx.world.notify({
      kind: t.kind,
      title: t.title,
      text: t.text,
      icon: t.icon,
      x: target ? target.x + (target.w >> 1) : t.x,
      y: target ? target.y + (target.h >> 1) : t.y,
      buildingId: target?.id,
    });
    st.cd[t.key] = day + t.cooldown;
    if (t.key.startsWith('unlock_')) ctx.state.hintedMilestone = ctx.world.milestone;
    st.last = day;
    st.next = day + ADVISOR_MIN_GAP + (t.kind === 'info' || t.kind === 'good' ? ADVISOR_INFO_EXTRA_GAP : 0);
    if (t.kind === 'danger' || t.kind === 'warning') {
      try { ctx.game.audio.play(t.kind === 'danger' ? 'warning' : 'notice', 0.6); } catch { /* audio optional */ }
    }
  }

  /** All currently applicable tips (unsorted, cooldowns not applied). */
  evaluate(): AdvisorTip[] {
    const ctx = this.ctx, w = ctx.world, s = w.stats, a = ctx.last, r = ctx.state.rates, f = ctx.game.fields;
    const tips: AdvisorTip[] = [];
    const add = (t: AdvisorTip) => tips.push(t);
    const sample = (p: number) => w.buildings.get(a.sample(p));
    const pop = s.population;
    const n = Math.max(1, a.zoned);
    const suggest = (cat: BuildingCategory, pred?: (d: BuildingDef) => boolean) => {
      const d = cheapestUnlocked(w, cat, pred);
      return d ? ` Try a ${d.name} (${formatMoney(d.cost)}).` : '';
    };
    const producesPower = (d: BuildingDef) => (d.power ?? 0) > 0;
    const producesWater = (d: BuildingDef) => (d.water ?? 0) > 0;
    const treatsSewage = (d: BuildingDef) => (d.sewage ?? 0) > 0;
    const hasCapacity = (d: BuildingDef) => (d.capacity ?? 0) > 0;
    const dispatches = (d: BuildingDef) => (d.vehicles?.count ?? 0) > 0;

    // ── getting started ───────────────────────────────────────────────────
    const zonedCells = ctx.candidates.count(0) + ctx.candidates.count(1) + ctx.candidates.count(2) + ctx.candidates.count(3);
    if (a.zoned === 0 && zonedCells === 0 && ctx.day > 3) {
      add({ key: 'start_zone', kind: 'info', icon: '🗺️', priority: 60, cooldown: 20, title: 'Zone some land', text: 'Draw roads off the highway, then paint residential, commercial and industrial zones along them. Buildings grow where there is demand.' });
    }
    if (ctx.outside.hasConnections && a.zoned > 0 && a.connected === 0) {
      const c = w.connections.find((k) => k.kind === 'highway');
      add({ key: 'connect', kind: 'danger', icon: '🛣️', priority: 100, cooldown: 12, title: 'Not connected to the highway', text: 'Your roads do not reach the highway, so nobody can move in and no goods can arrive. Connect your streets to the highway.', x: c?.x, y: c?.y });
    }

    // ── utilities ─────────────────────────────────────────────────────────
    const noPower = a.problems(Problem.NoPower);
    if (noPower > 0) {
      const prod = f?.power?.produced ?? 0, cons = f?.power?.consumed ?? 0;
      if (a.nominalMW <= 0 && prod <= 0) add({ key: 'power_none', kind: 'danger', icon: '⚡', priority: 95, cooldown: 15, title: 'No electricity', text: `Nothing produces power yet. Build a power plant and connect it with roads — power flows along them.${suggest('power', producesPower)}`, target: sample(Problem.NoPower) });
      else if (cons > prod * 0.98) add({ key: 'power_short', kind: 'warning', icon: '⚡', priority: 85, cooldown: 20, title: 'Not enough electricity', text: `Demand (${Math.round(cons)} MW) exceeds production (${Math.round(prod)} MW). Build more power plants.${suggest('power', producesPower)}`, target: sample(Problem.NoPower) });
      else add({ key: 'power_link', kind: 'warning', icon: '🔌', priority: 70, cooldown: 25, title: 'Buildings without power', text: `${noPower} building${noPower > 1 ? 's are' : ' is'} not connected to the grid. Power reaches buildings through connected roads.`, target: sample(Problem.NoPower) });
    }
    const noWater = a.problems(Problem.NoWater);
    if (noWater > 0) {
      const prod = f?.water?.produced ?? 0, cons = f?.water?.consumed ?? 0;
      if (prod <= 0) add({ key: 'water_none', kind: 'danger', icon: '💧', priority: 94, cooldown: 15, title: 'No running water', text: `Build a water pump on a shoreline or a water tower anywhere, and connect it with roads — pipes follow them.${suggest('water', producesWater)}`, target: sample(Problem.NoWater) });
      else if (cons > prod * 0.98) add({ key: 'water_short', kind: 'warning', icon: '💧', priority: 84, cooldown: 20, title: 'Not enough water', text: `Consumption (${Math.round(cons)} m³/day) exceeds supply (${Math.round(prod)} m³/day). Build more pumps or water towers.${suggest('water', producesWater)}`, target: sample(Problem.NoWater) });
      else add({ key: 'water_link', kind: 'warning', icon: '🚰', priority: 68, cooldown: 25, title: 'Buildings without water', text: `${noWater} building${noWater > 1 ? 's are' : ' is'} not connected to the water network.`, target: sample(Problem.NoWater) });
    }
    const noSewage = a.problems(Problem.NoSewage);
    if (noSewage > n * 0.05) {
      const cap = f?.sewage?.produced ?? 0;
      add({ key: 'sewage', kind: 'warning', icon: '🚽', priority: cap <= 0 ? 90 : 72, cooldown: 25, title: cap <= 0 ? 'No sewage disposal' : 'Sewage backing up', text: cap <= 0 ? `Build a sewage outlet or treatment plant (downstream, away from your water pumps).${suggest('water', treatsSewage)}` : `Sewage capacity is insufficient or disconnected. Build more sewage capacity.${suggest('water', treatsSewage)}`, target: sample(Problem.NoSewage) });
    }

    // ── services ──────────────────────────────────────────────────────────
    const grace = ctx.graceLeft('garbage');
    if (ctx.unlocked('garbage') && a.gbIntake + a.gbThroughput <= 0 && pop > 200) {
      add({ key: 'garbage_none', kind: grace > 0 ? 'info' : 'warning', icon: '🗑️', priority: grace > 0 ? 55 : 80, cooldown: 25, title: 'Garbage collection needed', text: grace > 0 ? `Garbage services are now available. Build a landfill within ${grace} days before trash starts piling up.${suggest('garbage', hasCapacity)}` : `Garbage is piling up with nowhere to go.${suggest('garbage', hasCapacity)}` });
    } else if (a.problems(Problem.Garbage) > n * 0.05) {
      add({ key: 'garbage_more', kind: 'warning', icon: '🗑️', priority: 66, cooldown: 25, title: 'Garbage piling up', text: 'Garbage trucks cannot keep up. Build more landfills, incinerators or recycling centers, closer to the problem areas.', target: sample(Problem.Garbage) });
    }
    if (a.gbStorageCap > 0 && a.gbStored > a.gbStorageCap * 0.9 && a.gbThroughput < a.garbageProduced * 0.8) {
      add({ key: 'landfill_full', kind: 'warning', icon: '🗑️', priority: 64, cooldown: 40, title: 'Landfills almost full', text: `Your landfills are ${formatPercent(a.gbStored / a.gbStorageCap)} full. Build a new landfill or an incinerator.` });
    }
    if (ctx.unlocked('health') && pop > 600) {
      if (a.healthCap <= 0) add({ key: 'health_none', kind: ctx.serviceOn('health') ? 'warning' : 'info', icon: '🏥', priority: 58, cooldown: 40, title: 'No healthcare', text: `Citizens get sick and nobody treats them. Build a clinic.${suggest('health', hasCapacity)}` });
      else if (a.sick > a.healthCap * 1.15) add({ key: 'health_more', kind: 'warning', icon: '🏥', priority: 60, cooldown: 35, title: 'Clinics are overcrowded', text: `${Math.round(a.sick)} sick citizens, capacity ${Math.round(a.healthCap)}. Build more healthcare.`, target: sample(Problem.Sick) });
    }
    if (a.problems(Problem.Dead) > 0) {
      add({ key: 'deathcare', kind: 'warning', icon: '⚰️', priority: 67, cooldown: 30, title: 'The dead are not collected', text: `Build a cemetery or crematorium and keep hearses within reach.${suggest('deathcare', hasCapacity)}`, target: sample(Problem.Dead) });
    } else if (ctx.unlocked('deathcare') && a.dcIntake + a.dcThroughput <= 0 && pop > 1000) {
      add({ key: 'deathcare_none', kind: 'info', icon: '⚰️', priority: 50, cooldown: 45, title: 'Plan for deathcare', text: `Deathcare is available. Build a cemetery before the elderly population needs it.${suggest('deathcare', hasCapacity)}` });
    }
    if (ctx.unlocked('education') && pop > 800) {
      if (a.eduCap <= 0) add({ key: 'school_none', kind: 'info', icon: '🏫', priority: 52, cooldown: 45, title: 'Build schools', text: `Educated citizens earn more, level up their homes and staff offices.${suggest('education', hasCapacity)}` });
      else if (a.studentsPotential > a.eduCap * 1.2) add({ key: 'school_more', kind: 'info', icon: '🏫', priority: 54, cooldown: 40, title: 'Schools are full', text: `${Math.round(a.studentsPotential)} students for ${Math.round(a.eduCap)} places. Build more schools.` });
    }
    if (a.problems(Problem.Crime) > n * 0.05 || (s.crimeRate > 30 && pop > 1000)) {
      add({ key: 'crime', kind: 'warning', icon: '🚓', priority: 62, cooldown: 35, title: 'Crime is rising', text: `Build police stations to cover the affected neighbourhoods.${suggest('police', dispatches)}`, target: sample(Problem.Crime) });
    }
    if (ctx.unlocked('fire') && pop > 700 && !(a.serviceByCat.fire > 0)) {
      add({ key: 'fire_none', kind: 'info', icon: '🚒', priority: 56, cooldown: 60, title: 'No fire protection', text: `A single fire can spread across a block. Build a fire station.${suggest('fire', dispatches)}` });
    }
    if (pop > 2000 && a.parks === 0) {
      add({ key: 'parks', kind: 'info', icon: '🌳', priority: 35, cooldown: 90, title: 'Parks make people happy', text: 'Parks and plazas raise land value and happiness — homes near them level up faster.' });
    }

    // ── economy ───────────────────────────────────────────────────────────
    const net = w.stats.netIncome;
    if (!w.creative && w.economy.money < 0) {
      add({ key: 'money_neg', kind: 'danger', icon: '💸', priority: 92, cooldown: 20, title: 'The treasury is in debt', text: `Money: ${formatMoney(w.economy.money)}. Raise taxes, lower service budgets or take a loan before construction freezes.` });
    } else if (!w.creative && net < 0 && pop > 100) {
      add({ key: 'money_loss', kind: 'warning', icon: '📉', priority: 74, cooldown: 30, title: 'Losing money every month', text: `The budget projects ${formatMoney(net)} per month. Consider raising taxes slightly or trimming budgets.` });
    }
    const taxes = Object.values(w.economy.taxes);
    const avgTax = taxes.reduce((x, y) => x + y, 0) / taxes.length;
    if (avgTax > 0.16 && pop > 500) {
      add({ key: 'taxes_high', kind: 'warning', icon: '🧾', priority: 45, cooldown: 60, title: 'Taxes are high', text: `Average tax ${formatPercent(avgTax)}. Above 12 % demand and happiness start to suffer.` });
    }

    // ── labour market & demand ────────────────────────────────────────────
    if (r.unemployment > 0.12 && pop > 400) {
      add({ key: 'unemployment', kind: 'warning', icon: '💼', priority: 65, cooldown: 30, title: 'High unemployment', text: `${formatPercent(r.unemployment)} of workers have no job. Zone more commercial, industrial${w.isUnlocked(4) ? ' or office' : ''} land.` });
    }
    if (a.zonedJobs > 50 && r.uneFill < 0.8) {
      add({ key: 'workers', kind: 'warning', icon: '🧑‍🏭', priority: 63, cooldown: 30, title: 'Businesses need workers', text: 'There are more jobs than workers. Zone more residential areas.', target: sample(Problem.NoWorkers) });
    }
    if (a.problems(Problem.NoEducated) > n * 0.05) {
      add({ key: 'educated', kind: 'info', icon: '🎓', priority: 48, cooldown: 45, title: 'Not enough educated workers', text: 'Offices and advanced industry need educated staff. Improve school coverage and capacity.', target: sample(Problem.NoEducated) });
    }
    if (a.problems(Problem.NoGoods) > n * 0.05) {
      add({ key: 'goods', kind: 'info', icon: '📦', priority: 47, cooldown: 40, title: 'Shops lack goods', text: 'Commercial buildings need goods from industry (or imports via the highway). Zone more industry.', target: sample(Problem.NoGoods) });
    }
    if (a.problems(Problem.NoCustomers) > n * 0.08) {
      add({ key: 'customers', kind: 'info', icon: '🛍️', priority: 40, cooldown: 45, title: 'Businesses lack customers', text: 'Some shops and factories cannot sell enough. More residents (or exports via the highway) will help.', target: sample(Problem.NoCustomers) });
    }
    const d = s.demand;
    const free = (c: number) => ctx.candidates.count(c);
    if (d.res > 0.55 && free(0) < 8) add({ key: 'demand_res', kind: 'info', icon: '🏡', priority: 44, cooldown: 30, title: 'Residential demand is high', text: 'People want to move in. Zone more residential land along your roads.' });
    if (d.com > 0.55 && free(1) < 6) add({ key: 'demand_com', kind: 'info', icon: '🏪', priority: 43, cooldown: 30, title: 'Commercial demand is high', text: 'Residents want places to shop. Zone commercial land near homes.' });
    if (d.ind > 0.55 && free(2) < 6) add({ key: 'demand_ind', kind: 'info', icon: '🏭', priority: 42, cooldown: 30, title: 'Industrial demand is high', text: 'Industry wants to expand. Zone industrial land — away from homes, near the highway.' });
    if (d.off > 0.55 && free(3) < 6) add({ key: 'demand_off', kind: 'info', icon: '🏙️', priority: 41, cooldown: 30, title: 'Office demand is high', text: 'Educated workers want office jobs. Zone office land.' });

    // ── environment & traffic ─────────────────────────────────────────────
    if (a.problems(Problem.Pollution) > n * 0.06) {
      add({ key: 'pollution', kind: 'warning', icon: '🏭', priority: 50, cooldown: 45, title: 'Pollution in neighbourhoods', text: 'Homes and shops near industry or power plants suffer. Keep a buffer, plant trees or switch to cleaner power.', target: sample(Problem.Pollution) });
    }
    if (a.problems(Problem.Noise) > n * 0.08) {
      add({ key: 'noise', kind: 'info', icon: '🔊', priority: 30, cooldown: 60, title: 'Noisy neighbourhoods', text: 'Busy roads and industry are loud. Residents prefer quieter streets.', target: sample(Problem.Noise) });
    }
    if (s.trafficFlow < 55 && pop > 2000) {
      add({ key: 'traffic', kind: 'warning', icon: '🚦', priority: 57, cooldown: 40, title: 'Traffic congestion', text: `Traffic flows at ${Math.round(s.trafficFlow)} %. Upgrade busy streets to avenues, add alternative routes and public transport.` });
    }
    if (a.abandoned > 0) {
      add({ key: 'abandoned', kind: 'warning', icon: '🏚️', priority: 46, cooldown: 30, title: `${a.abandoned} abandoned building${a.abandoned > 1 ? 's' : ''}`, text: ctx.settings.gameplay.autoBulldozeAbandoned ? 'Fix the underlying problems or they will be demolished and rebuilt.' : 'Fix the problems nearby (utilities, services, pollution) or bulldoze them to make room.', target: sample(Problem.Abandoned) });
    }

    // ── what to build next (level-up blockers of homes) ───────────────────
    const blocks = a.blockCount;
    const growable = Math.max(1, a.zoned - a.abandoned);
    const top = [LevelBlock.Services, LevelBlock.Education, LevelBlock.LandValue, LevelBlock.EducatedWorkers]
      .map((b) => ({ b, n: blocks[b] }))
      .sort((x, y) => y.n - x.n)[0];
    if (top && top.n > growable * 0.3 && pop > 1500) {
      const text: Record<number, string> = {
        [LevelBlock.Services]: 'Many buildings need better service coverage to level up. Fill gaps in police, fire, health, education and parks coverage.',
        [LevelBlock.Education]: 'Homes need better educated residents to level up. Build more schools and extend their coverage.',
        [LevelBlock.LandValue]: 'Buildings need higher land value to level up. Parks, plazas, services and transit raise land value; pollution and noise lower it.',
        [LevelBlock.EducatedWorkers]: 'Businesses need a more educated workforce to level up. Invest in high schools and universities.',
      };
      add({ key: 'levelup_' + top.b, kind: 'info', icon: '📈', priority: 33, cooldown: 75, title: 'How to grow further', text: text[top.b] });
    }

    // ── unlocks ───────────────────────────────────────────────────────────
    const st = ctx.state;
    if (w.milestone > st.hintedMilestone) {
      const idx = w.milestone;
      const names = unlockedAt(idx).slice(0, 5).map((x) => x.name);
      const pols = POLICIES.filter((p) => p.unlock === idx).length;
      const parts: string[] = [];
      if (names.length) parts.push(`New buildings: ${names.join(', ')}.`);
      if (pols) parts.push(`${pols} new ${pols > 1 ? 'policies' : 'policy'} available.`);
      const ms = MILESTONES[idx];
      if (!parts.length) st.hintedMilestone = idx;
      else add({ key: 'unlock_' + idx, kind: 'good', icon: '🔓', priority: 99, cooldown: 1000, title: `Unlocked at ${ms?.name ?? 'this milestone'}`, text: parts.join(' ') });
    }
    return tips;
  }
}
