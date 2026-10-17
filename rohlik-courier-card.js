/*
 * Rohlík.cz – delivery banner card.
 *
 * A slim full-width banner that changes with the order:
 *   - ordered, courier not yet on the way: the delivery window, Rohlík's
 *     latest message and the order summary;
 *   - courier on the way: the countdown, the trip progress (departure → live
 *     ETA, which keeps moving) and the reusable bags to hand back;
 *   - no order: hidden.
 * Installed through HACS (Dashboard), which also adds the Lovelace resource:
 *
 *   type: custom:rohlik-courier-card
 *
 * Needs the Rohlík.cz integration with courier tracking
 * (https://github.com/hruskin/HA-Rohlik-dynamic) for the courier states.
 *
 * Entities are found by the integration's translation keys; override with
 * `<name>_entity` (courier, eta, minutes, bags, ordered, info, since, till, deadline).
 */

const VERSION = "1.0.6";
const DOMAIN = "rohlikcz";
const KEYS = {
  courier: ["binary_sensor", "courier_on_the_way"],
  eta: ["sensor", "delivery_time"],
  minutes: ["sensor", "delivery_minutes"],
  bags: ["sensor", "bags_amount"],
  ordered: ["binary_sensor", "is_ordered"],
  info: ["sensor", "delivery_info"],
  since: ["sensor", "next_order_since"],
  till: ["sensor", "next_order_till"],
  deadline: ["sensor", "order_edit_deadline"],
};
// Rohlík.cz brand icon from the Home Assistant brands repository (what HA itself shows).
const LOGO_URL = "https://brands.home-assistant.io/rohlikcz/icon.png";
const NEARBY_MINUTES = 8;
const SHIFT_MINUTES = 5;
const TICK_MS = 30_000;
const ITEMS_IDLE_MS = 90_000;

const STYLE = `
:host { display: block; container: rk / inline-size; }
:host([hidden]) { display: none; }

.banner {
  --rk-bg: var(--ha-card-background, var(--card-background-color, #fff));
  --rk-border: var(--ha-card-border-color, var(--divider-color, #e0e0e0));
  --rk-radius: var(--ha-card-border-radius, 12px);
  --rk-text: var(--primary-text-color, #212121);
  --rk-text-2: var(--secondary-text-color, #727272);
  --rk-accent: var(--primary-color, #03a9f4);
  --rk-warn: var(--warning-color, #ff9800);
  --rk-warn-text: color-mix(in srgb, var(--rk-warn) 74%, var(--rk-text));
  --rk-rail: color-mix(in srgb, var(--rk-text) 10%, transparent);
  --rk-state: var(--rk-accent);
  --rk-num-weight: 400;

  position: relative;
  box-sizing: border-box;
  min-height: 72px;
  padding: 12px 20px;
  display: grid;
  grid-template-columns: 52px 232px 1fr auto;
  grid-template-areas: "icon count track bags";
  align-items: center;
  column-gap: 20px;
  background: var(--rk-bg);
  border: var(--ha-card-border-width, 1px) solid var(--rk-border);
  border-radius: var(--rk-radius);
  box-shadow: var(--ha-card-box-shadow, none);
  color: var(--rk-text);
  font-family: var(--ha-font-family-body, Roboto, "Helvetica Neue", Arial, sans-serif);
  -webkit-font-smoothing: antialiased;
  cursor: pointer;
  outline: none;
}
.banner:focus-visible { box-shadow: 0 0 0 2px var(--rk-accent); }
ha-icon { display: block; }

.icon {
  grid-area: icon;
  width: 48px; height: 48px; border-radius: 50%;
  display: grid; place-items: center;
  color: var(--rk-state);
  background: color-mix(in srgb, var(--rk-state) 12%, transparent);
  --mdc-icon-size: 28px;
}
.icon__logo { display: none; width: 40px; height: 40px; object-fit: contain; }
.icon__speed { display: none; width: 12px; height: 24px; margin-right: -2px; }
.icon--logo { width: 52px; border-radius: 0; background: none; display: flex; align-items: center; justify-content: center; }
.icon--logo .icon__logo { display: block; }
.icon--logo .icon__speed { display: block; }
.banner--ordered .icon__speed { display: none; }
.icon--logo ha-icon { display: none !important; }

.count { grid-area: count; min-width: 0; }
/* fixed countdown width while on the way, so the trip rail never jumps between states */
.banner:not(.banner--ordered):not(.banner--arriving) .count { min-width: var(--rk-count-w, 150px); }
.count__main { display: flex; align-items: baseline; gap: 6px; white-space: nowrap; }
.count__num {
  font-size: 44px; line-height: 44px; font-weight: var(--rk-num-weight); letter-spacing: -.5px;
  font-variant-numeric: tabular-nums;
}
.count__unit { font-size: 20px; color: var(--rk-text-2); }
.count__sub {
  margin-top: 6px; font-size: 15px; line-height: 20px; color: var(--rk-text-2);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.count__sub:empty { display: none; }

.track { grid-area: track; min-width: 0; }
.track__line { display: flex; align-items: center; gap: 10px; }
.track__rail { position: relative; flex: 1; height: 6px; border-radius: 3px; background: var(--rk-rail); }
.track__fill {
  position: absolute; inset: 0 auto 0 0; width: calc(var(--p) * 100%);
  border-radius: inherit; background: var(--rk-state);
  transition: width .8s ease;
}
.track__marker {
  position: absolute; top: 50%; left: calc(var(--p) * 100%);
  width: 14px; height: 14px; margin: -7px 0 0 -7px; border-radius: 50%;
  background: var(--rk-state); box-shadow: 0 0 0 3px var(--rk-bg);
  transition: left .8s ease;
}
.track__home { color: var(--rk-text-2); --mdc-icon-size: 20px; }
.track__labels {
  display: flex; justify-content: flex-end; align-items: baseline; margin: 2px 32px 0 0;
  font-size: 13px; line-height: 20px; color: var(--rk-text-2);
  font-variant-numeric: tabular-nums;
}
.track__eta { color: var(--rk-text-2); font-size: 15px; }
.track__eta b { font-size: 17px; color: var(--rk-text); }
.track__eta b { font-weight: 500; }
.track__eta s { text-decoration-thickness: 1px; color: var(--rk-text-2); }
.shift { color: var(--rk-warn-text); font-weight: 500; font-size: 13px; position: relative; top: -6px; line-height: 0; margin-left: 1px; display: none; }
.banner--shifted .shift { display: inline; }

.info { grid-area: track; min-width: 0; display: none; justify-self: end; text-align: right; }
/* add-items deadline: built like the bags block (icon · value · caption), next to it */
.add { display: grid; grid-template-columns: auto auto; column-gap: 10px; align-items: center; justify-content: end; text-align: left; }
.add ha-icon { color: var(--rk-text-2); --mdc-icon-size: 26px; grid-row: span 2; }
.add__time { font-size: 22px; line-height: 26px; color: var(--rk-text); font-variant-numeric: tabular-nums; white-space: nowrap; }
.add__cap { font-size: 13px; line-height: 16px; color: var(--rk-text-2); white-space: nowrap; }
.add--soon .add__time { color: var(--rk-warn-text); }
.banner--ordered .info { display: block; }
.banner--ordered .track { display: none; }

.bags {
  grid-area: bags;
  align-self: stretch;
  box-sizing: border-box; min-width: 150px;
  display: grid; grid-template-columns: auto auto auto; column-gap: 8px;
  align-items: center; align-content: center; justify-content: center;
  padding: 0 10px 0 18px; margin: -4px -8px -4px 0;
  border-left: 1px solid var(--rk-border);
}
.bags__icon { color: var(--rk-text-2); --mdc-icon-size: 24px; }
.bags__num { font-size: 36px; line-height: 40px; font-weight: var(--rk-num-weight); font-variant-numeric: tabular-nums; }
.bags__cap { font-size: 13px; line-height: 16px; color: var(--rk-text-2); white-space: pre-line; }

/* order items: a native modal dialog, so it escapes the card's containment */
.items {
  box-sizing: border-box; width: min(480px, calc(100vw - 32px)); max-height: min(80vh, 640px);
  max-width: none;
  padding: 0; border: none; border-radius: var(--ha-card-border-radius, 12px);
  background: var(--card-background-color, #fff); color: var(--primary-text-color, #212121);
  font-family: var(--ha-font-family-body, Roboto, "Helvetica Neue", Arial, sans-serif);
  box-shadow: 0 8px 32px rgba(0, 0, 0, .25);
}
.items[open] { display: flex; flex-direction: column; }
.items::backdrop { background: rgba(0, 0, 0, .4); }
.items__head {
  display: flex; align-items: center; gap: 12px; padding: 16px 12px 12px 20px;
  border-bottom: 1px solid var(--divider-color, #e0e0e0);
}
.items__title { flex: 1; font-size: 18px; font-weight: 500; }
.items__close {
  width: 48px; height: 48px; margin: -6px -6px -6px 0; border: none; border-radius: 50%; background: none; cursor: pointer;
  color: var(--secondary-text-color, #727272); font-size: 28px; line-height: 48px;
}
.items__close:hover { background: color-mix(in srgb, var(--primary-text-color, #212121) 8%, transparent); }
.items__list { list-style: none; margin: 0; padding: 4px 0 12px; overflow-y: auto; outline: none; }
.items__list li {
  display: flex; justify-content: space-between; gap: 32px; padding: 10px 20px;
  font-size: 15px; line-height: 20px;
}
.items__list li + li { border-top: 1px solid color-mix(in srgb, var(--divider-color, #e0e0e0) 60%, transparent); }
.items__qty { flex: none; color: var(--secondary-text-color, #727272); font-variant-numeric: tabular-nums; }

/* sits on the top border like a fieldset legend, clear of the content */
.preview-note {
  position: absolute; top: 0; left: 50%; transform: translate(-50%, -50%);
  padding: 0 8px; background: var(--rk-bg); white-space: nowrap;
  font-size: 11px; line-height: 14px; color: var(--rk-text-2); letter-spacing: .3px; text-transform: uppercase;
}

.banner--nearby .track__marker::after {
  content: ""; position: absolute; inset: -3px; border-radius: 50%;
  border: 2px solid var(--rk-state); opacity: 0;
  animation: rk-halo 2.4s ease-out infinite;
}
@keyframes rk-halo { 0% { transform: scale(1); opacity: .5; } 100% { transform: scale(2.4); opacity: 0; } }

.banner--arriving .count__num { font-size: 40px; letter-spacing: 0; }
.banner--arriving .bags {
  border-left-color: transparent;
  background: color-mix(in srgb, var(--rk-accent) 10%, transparent);
  border-radius: calc(var(--rk-radius) - 4px);
}
.banner--arriving .bags__icon { color: var(--rk-accent); }
.banner--arriving .bags__cap { color: var(--rk-text); }

.banner--late { --rk-state: var(--rk-warn); }
.banner--late .count__num { color: var(--rk-warn-text); }

/* the closer the courier, the more the whole banner says so – readable from across the room */
.banner { transition: border-color .6s ease, background-color .6s ease; }
.count__num { transition: color .6s ease; }
.banner--nearby { border-color: var(--rk-accent); }
.banner--nearby .count__num { color: var(--rk-accent); }
.banner--arriving {
  border-color: var(--rk-accent);
  background: color-mix(in srgb, var(--rk-accent) 14%, var(--rk-bg));
}
.banner--arriving .count__num { color: var(--rk-accent); }
.banner--arriving .bags { background: none; }
.banner--late { border-color: var(--rk-warn); }
.banner--late .track__eta, .banner--late .track__eta b { color: var(--rk-warn-text); }
.banner--late .track__eta s { color: inherit; }

/* narrower (portrait tablet, sections column): same single row, just tighter */
@container rk (max-width: 760px) {
  .banner { grid-template-columns: 46px auto 1fr auto; column-gap: 12px; padding: 10px 14px; }
  .icon { width: 46px; height: 40px; }
  .icon__logo { width: 34px; height: 34px; }
  .count__num { font-size: 38px; line-height: 40px; }
  .banner--arriving .count__num { font-size: 34px; }
  .count__unit { font-size: 17px; }
  .bags { min-width: 0; padding: 0 6px 0 14px; }
  .bags__num { font-size: 32px; line-height: 36px; }
  .banner { --rk-count-w: 124px; }
  .track__labels { font-size: 12px; }
  .track__eta { font-size: 13px; }
  .track__eta b { font-size: 16px; }
  .add__time { font-size: 20px; }
}
/* phone: the trip progress / add-items line moves to a second row */
@container rk (max-width: 460px) {
  .banner {
    grid-template-columns: 1fr auto;
    grid-template-areas: "count bags" "track track";
    row-gap: 6px;
  }
  .icon { display: none; }
  .count__num { font-size: 34px; line-height: 38px; }
  .add ha-icon { --mdc-icon-size: 20px; }
  .add__time { font-size: 17px; line-height: 20px; }
  .add__cap { display: none; }
}

/* compact_ordered: a thin one-row bar while ordered; full height once the courier leaves */
.banner.banner--thin {
  min-height: 40px; padding: 0 14px; column-gap: 12px; row-gap: 0;
  grid-template-columns: 30px auto 1fr auto; grid-template-areas: "icon count track bags";
}
.banner--thin .icon { display: flex; width: 30px; height: 30px; }
.banner--thin .icon__logo { width: 26px; height: 26px; }
.banner--thin .count__num { font-size: 20px; line-height: 24px; letter-spacing: 0; }
.banner--thin .count__unit { font-size: 15px; }
.banner--thin .add { column-gap: 6px; }
.banner--thin .add ha-icon { --mdc-icon-size: 20px; grid-row: auto; }
.banner--thin .add__time { font-size: 17px; line-height: 22px; }
.banner--thin .add__cap { display: none; }
.banner--thin .bags { align-self: center; min-width: 0; height: 24px; padding: 0 0 0 12px; margin: 0; column-gap: 6px; }
.banner--thin .bags__icon { --mdc-icon-size: 20px; }
.banner--thin .bags__num { font-size: 17px; line-height: 22px; }
.banner--thin .bags__cap { white-space: nowrap; }
@container rk (max-width: 460px) {
  .banner.banner--thin { grid-template-columns: auto 1fr auto; grid-template-areas: "count track bags"; }
  .banner--thin .icon, .banner--thin .bags__cap { display: none; }
}

@media (prefers-reduced-motion: reduce) {
  .track__fill, .track__marker, .banner, .count__num { transition: none; }
  .banner--nearby .track__marker::after { animation: none; opacity: .35; transform: scale(1.8); }
}
`;

const TEMPLATE = `
<div class="banner" role="button" tabindex="0">
  <div class="icon"><svg class="icon__speed" viewBox="0 0 12 24" aria-hidden="true"><g stroke="#F2A93B" stroke-width="2.4" stroke-linecap="round"><path d="M3 6h8" opacity=".5"/><path d="M1 12h10" opacity=".85"/><path d="M4 18h7" opacity=".5"/></g></svg><img class="icon__logo" alt="" aria-hidden="true"><ha-icon icon="mdi:truck-fast-outline" aria-hidden="true"></ha-icon></div>
  <div class="count">
    <div class="count__main"><span class="count__num"></span><span class="count__unit">min</span></div>
    <div class="count__sub"></div>
  </div>
  <div class="track" role="progressbar" aria-label="Průběh jízdy kurýra" aria-valuemin="0" aria-valuemax="100">
    <div class="track__line">
      <div class="track__rail">
        <div class="track__fill"></div>
        <div class="track__marker"></div>
      </div>
      <div class="track__home"><ha-icon icon="mdi:home-outline" aria-hidden="true"></ha-icon></div>
    </div>
    <div class="track__labels"><span class="track__eta"></span></div>
  </div>
  <div class="info"><div class="info__msg"></div></div>
  <div class="bags">
    <div class="bags__icon"><ha-icon icon="mdi:shopping-outline" aria-hidden="true"></ha-icon></div>
    <div class="bags__num"></div>
    <div class="bags__cap"></div>
  </div>
</div>
<dialog class="items" aria-label="Položky nákupu">
  <div class="items__head"><span class="items__title"></span><button class="items__close" aria-label="Zavřít">×</button></div>
  <ul class="items__list" tabindex="-1"></ul>
</dialog>
`;

const plural = (n, one, few, many) => (n === 1 ? one : n >= 2 && n <= 4 ? few : many);
const hm = (date) => date.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" });
const toDate = (value) => {
  const date = value ? new Date(value) : null;
  return date && !isNaN(date) ? date : null;
};
const DAY = 86400000;
const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
// "dnes" / "zítra" / "čt 23. 10."
const relativeDay = (date, now) => {
  const days = Math.round((startOfDay(date) - startOfDay(new Date(now))) / DAY);
  if (days === 0) return "dnes";
  if (days === 1) return "zítra";
  const weekday = date.toLocaleDateString("cs-CZ", { weekday: "short" });
  return `${weekday} ${date.getDate()}. ${date.getMonth() + 1}.`;
};

class RohlikCourierCard extends HTMLElement {
  static getStubConfig() {
    return {};
  }

  static async getConfigElement() {
    await loadEditorComponents();
    return document.createElement("rohlik-courier-card-editor");
  }

  setConfig(config) {
    this._config = config || {};
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  set preview(value) {
    this._preview = value;
    this._render();
  }

  set editMode(value) {
    this._editMode = value;
    this._render();
  }

  getCardSize() {
    return 2;
  }

  getGridOptions() {
    return { columns: "full", rows: "auto", min_columns: 6 };
  }

  connectedCallback() {
    this._timer = setInterval(() => this._render(), TICK_MS);
    this._render();
  }

  disconnectedCallback() {
    clearInterval(this._timer);
    clearTimeout(this._itemsTimer);
  }

  _entityId(name) {
    const configured = this._config?.[`${name}_entity`];
    if (configured) return configured;
    const [domain, key] = KEYS[name];
    const entities = this._hass?.entities || {};
    const found = Object.values(entities).find(
      (e) => e.platform === DOMAIN && e.translation_key === key && e.entity_id.startsWith(`${domain}.`)
    );
    return found?.entity_id;
  }

  _state(name) {
    const id = this._entityId(name);
    return id ? this._hass?.states[id] : undefined;
  }

  _build() {
    const root = this.attachShadow({ mode: "open" });
    root.innerHTML = `<style>${STYLE}</style>${TEMPLATE}`;
    const $ = (sel) => root.querySelector(sel);
    this._el = {
      banner: $(".banner"), icon: $(".icon ha-icon"), num: $(".count__num"), unit: $(".count__unit"),
      sub: $(".count__sub"), track: $(".track"), msg: $(".info__msg"), rail: $(".track__rail"),
      eta: $(".track__eta"), bagsNum: $(".bags__num"), bagsCap: $(".bags__cap"),
      iconTile: $(".icon"), logo: $(".icon__logo"),
    };
    // Without the brands CDN (offline tablet) fall back to the state icon.
    this._el.logo.addEventListener("error", () => {
      this._logoFailed = true;
      this._el.iconTile.classList.remove("icon--logo");
    });
    const dialog = root.querySelector(".items");
    root.querySelector(".items__close").addEventListener("click", () => dialog.close());
    // Nobody closes a dialog on a wall tablet: close it after a while without touch or scroll.
    const restartIdle = () => {
      clearTimeout(this._itemsTimer);
      if (dialog.open) this._itemsTimer = setTimeout(() => dialog.close(), ITEMS_IDLE_MS);
    };
    this._restartItemsIdle = restartIdle;
    for (const type of ["pointerdown", "scroll", "keydown"]) dialog.addEventListener(type, restartIdle, { capture: true, passive: true });
    dialog.addEventListener("close", () => clearTimeout(this._itemsTimer));
    // A click on the backdrop lands on the dialog element itself.
    dialog.addEventListener("click", (ev) => ev.target === dialog && dialog.close());
    const open = () => {
      if (this._openItems(dialog)) return;
      const entityId = this._entityId(this._mode === "ordered" ? "ordered" : "courier");
      if (!entityId) return;
      this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId }, bubbles: true, composed: true }));
    };
    this._el.banner.addEventListener("click", open);
    this._el.banner.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        open();
      }
    });
  }

  // The order's line items in a modal; false when the integration has none to show.
  _openItems(dialog) {
    const items = this._state("ordered")?.attributes?.items;
    if (!Array.isArray(items) || !items.length) return false;
    dialog.querySelector(".items__title").textContent =
      `Nákup · ${items.length} ${plural(items.length, "položka", "položky", "položek")}`;
    const list = dialog.querySelector(".items__list");
    list.replaceChildren(...items.map((item) => {
      const li = document.createElement("li");
      const name = document.createElement("span");
      name.textContent = item.name ?? "";
      const qty = document.createElement("span");
      qty.className = "items__qty";
      const amount = Number(item.amount) || 1;
      const textual = item.textual_amount || "";
      const perPiece = textual.match(/^1\s+(\S+)$/); // "1 ks" × 4 → "4 ks"
      qty.textContent = amount <= 1 ? textual || "1 ks"
        : perPiece ? `${amount} ${perPiece[1]}`
        : `${amount} ×${textual ? ` ${textual}` : ""}`;
      li.append(name, qty);
      return li;
    }));
    // Drop the list down from the banner when there is room below it, else centre it.
    const rect = this.getBoundingClientRect();
    const top = rect.bottom + 8;
    const anchored = window.innerHeight - top >= 240;
    Object.assign(dialog.style, anchored
      ? { margin: "0", inset: "auto", top: `${top}px`, left: `${rect.left}px`,
          // as wide as the item names need, never wider than the banner
          width: "fit-content", minWidth: `${Math.min(320, rect.width)}px`, maxWidth: `${rect.width}px`,
          maxHeight: `${window.innerHeight - top - 16}px` }
      : { margin: "", inset: "", top: "", left: "", width: "", minWidth: "", maxWidth: "", maxHeight: "" });
    dialog.showModal();
    // Centred under the banner (its width follows the item names).
    if (anchored) dialog.style.left = `${rect.left + (rect.width - dialog.offsetWidth) / 2}px`;
    list.focus(); // not the close button, which would show a focus ring
    list.scrollTop = 0;
    this._restartItemsIdle();
    return true;
  }

  _data() {
    const courier = this._state("courier");
    if (courier?.state !== "on" && this._state("ordered")?.state === "on") return this._orderedData();
    if (courier?.state !== "on") {
      // The "Add card" picker renders a live preview without setting preview/editMode.
      const inPicker = this.getRootNode()?.host?.localName === "hui-card-picker";
      if (!(this._preview || this._editMode || inPicker)) return null;
      // Dashboard editor: show what the banner looks like.
      const now = Date.now();
      return {
        mode: "trip", demo: true, now, dep: new Date(now - 43 * 60000), eta: new Date(now + 47 * 60000),
        eta0: new Date(now + 47 * 60000), mins: 47, nearby: false, bags: 9,
      };
    }
    const a = courier.attributes;
    const now = Date.now();
    const eta = toDate(this._state("eta")?.state);
    const minutesState = Number.parseInt(this._state("minutes")?.state, 10);
    const mins = Number.isNaN(minutesState)
      ? eta && Math.floor((eta - now) / 60000)
      : minutesState;
    const bags = Number.parseInt(this._state("bags")?.state, 10);
    return {
      mode: "trip", now, eta, mins: mins ?? null,
      dep: toDate(a.departed_at),
      eta0: toDate(a.initial_eta) || eta,
      nearby: a.nearby,
      bags: Number.isNaN(bags) ? null : bags,
    };
  }

  _orderedData() {
    const order = this._state("ordered")?.attributes?.order_data || {};
    const slot = order.deliverySlot || {};
    const bags = Number.parseInt(this._state("bags")?.state, 10);
    return {
      mode: "ordered", now: Date.now(),
      since: toDate(this._state("since")?.state) || toDate(slot.since),
      till: toDate(this._state("till")?.state) || toDate(slot.till),
      deadline: toDate(this._state("deadline")?.state),
      bags: Number.isNaN(bags) ? null : bags,
    };
  }

  _renderOrdered(d) {
    const el = this._el;
    const thin = this._config.compact_ordered === true;
    el.banner.className = `banner banner--ordered${thin ? " banner--thin" : ""}`;
    el.icon.setAttribute("icon", "mdi:package-variant-closed");
    el.num.textContent = d.since ? hm(d.since) : "–";
    el.unit.hidden = !d.since;
    el.unit.textContent = d.since ? relativeDay(d.since, d.now) : "";
    const till = d.till ? hm(d.till) : null;
    el.sub.textContent = "";
    // Only until when items can still be added; nothing once that has passed.
    const canAdd = d.deadline && d.deadline > d.now;
    // Cart-plus icon and the time; the day only when it is more than a day away.
    const until = canAdd
      ? `${d.deadline - d.now > DAY ? `${relativeDay(d.deadline, d.now)} ` : ""}${hm(d.deadline)}`
      : "";
    // The last hour before the deadline in the warning colour.
    const soon = canAdd && d.deadline - d.now < 3600000;
    el.msg.innerHTML = canAdd
      ? `<div class="add${soon ? " add--soon" : ""}"><ha-icon icon="mdi:cart-plus"></ha-icon>`
        + `<span class="add__time">do ${until}</span><span class="add__cap">přidat zboží</span></div>`
      : "";
    el.bagsNum.textContent = String(d.bags ?? "–");
    el.bagsCap.textContent = `${plural(d.bags ?? 0, "taška", "tašky", "tašek")}${thin ? "" : "\nk vrácení"}`;
    el.banner.setAttribute("aria-label",
      `Rohlík: objednávka${d.since ? ` dorazí ${relativeDay(d.since, d.now)} od ${hm(d.since)}` : ""}${till ? ` do ${till}` : ""}.`
      + (canAdd ? ` Zboží lze přidat do ${relativeDay(d.deadline, d.now)} ${hm(d.deadline)}.` : ""));
  }

  _render() {
    if (!this._hass || !this._config) return;
    const d = this._data();
    this.hidden = d === null;
    if (d === null) return;
    if (!this._el) this._build();
    const el = this._el;
    this._mode = d.mode;
    this.shadowRoot.querySelector(".preview-note")?.remove();
    const logo = this._config.show_logo !== false && !this._logoFailed;
    if (logo && !el.logo.getAttribute("src")) el.logo.src = LOGO_URL;
    el.iconTile.classList.toggle("icon--logo", logo);
    el.banner.style.setProperty("--rk-num-weight", this._config.number_weight === "bold" ? "600" : "400");
    if (d.mode === "ordered") {
      this._renderOrdered(d);
      return;
    }

    const mins = d.mins;
    const state = mins === null ? "on-way"
      : mins < 0 ? "late"
      : mins <= 1 ? "arriving"
      : d.nearby || mins <= NEARBY_MINUTES ? "nearby"
      : "on-way";
    const shift = d.eta && d.eta0 ? Math.round((d.eta - d.eta0) / 60000) : 0;
    const shifted = shift >= SHIFT_MINUTES;

    el.banner.className = `banner banner--${state}${shifted ? " banner--shifted" : ""}`;
    el.icon.setAttribute("icon", state === "arriving" ? "mdi:map-marker-radius-outline" : "mdi:truck-fast-outline");

    // An hour or more reads better as "1 h 35" than "95 min".
    const long = state !== "late" && state !== "arriving" && mins !== null && mins >= 60;
    el.num.textContent = state === "late" ? `+${-mins}`
      : state === "arriving" ? "Přijíždí"
      : mins === null ? "–"
      : long ? `${Math.floor(mins / 60)} h ${String(mins % 60).padStart(2, "0")}`
      : String(mins);
    el.unit.textContent = "min";
    el.unit.hidden = state === "arriving" || long;
    el.sub.textContent = "";

    // Trip progress: departure → current ETA. The ETA moves, so the marker can slide back.
    const dep = d.dep && d.eta && d.dep < d.eta ? d.dep : d.eta ? new Date(Math.min(d.now, d.eta - 3600000)) : null;
    const span = dep && d.eta ? Math.max(60000, d.eta - dep) : null;
    const p = span ? Math.max(0, Math.min(1, (d.now - dep) / span)) : 0;
    el.rail.style.setProperty("--p", p.toFixed(3));
    el.track.setAttribute("aria-valuenow", String(Math.round(p * 100)));
    el.eta.innerHTML = !d.eta ? ""
      : state === "late" ? `zpoždění · měl být <s>${hm(d.eta)}</s>`
      : `příjezd <b>${hm(d.eta)}</b><span class="shift">+${shift}</span>`;

    const bags = d.bags ?? "–";
    el.bagsNum.textContent = String(bags);
    el.bagsCap.textContent = state === "arriving"
      ? "připravte\nk vrácení"
      : `${plural(d.bags ?? 0, "taška", "tašky", "tašek")}\nk vrácení`;

    const bagsText = d.bags === null ? "" : ` Vrátit ${d.bags} ${plural(d.bags, "tašku", "tašky", "tašek")}.`;
    el.banner.setAttribute("aria-label",
      state === "late" ? `Rohlík: kurýr má zpoždění ${-mins} minut.${bagsText}`
      : state === "arriving" ? `Rohlík: kurýr přijíždí.${bagsText}`
      : `Rohlík: kurýr dorazí za ${mins ?? "?"} minut${d.eta ? `, v ${hm(d.eta)}` : ""}.${bagsText}`);

    if (d.demo) {
      const note = document.createElement("div");
      note.className = "preview-note";
      note.textContent = "Náhled · zobrazí se při objednávce";
      el.banner.append(note);
    }
  }
}

// Make sure ha-form and the entity picker are loaded before the editor renders:
// building the stock entities card's editor pulls them in.
const loadEditorComponents = async () => {
  if (customElements.get("ha-form") && customElements.get("ha-entity-picker")) return;
  const helpers = await window.loadCardHelpers?.();
  const card = await helpers?.createCardElement({ type: "entities", entities: [] });
  await card?.constructor?.getConfigElement?.();
};

const ENTITY_FIELDS = [
  ["courier_entity", "Kurýr na cestě", "binary_sensor"],
  ["eta_entity", "Čas doručení", "sensor"],
  ["minutes_entity", "Minuty do doručení", "sensor"],
  ["bags_entity", "Počet tašek", "sensor"],
  ["ordered_entity", "Další objednávka", "binary_sensor"],
  ["info_entity", "Informace o doručení", "sensor"],
  ["since_entity", "Začátek doručení", "sensor"],
  ["till_entity", "Konec doručení", "sensor"],
  ["deadline_entity", "Doobjednat do", "sensor"],
];
const EDITOR_SCHEMA = [
  { name: "show_logo", selector: { boolean: {} } },
  { name: "compact_ordered", selector: { boolean: {} } },
  {
    name: "number_weight",
    selector: {
      select: {
        mode: "dropdown",
        options: [
          { value: "regular", label: "Normální" },
          { value: "bold", label: "Tučné" },
        ],
      },
    },
  },
  {
    name: "entities",
    type: "expandable",
    flatten: true,
    title: "Entity (jen při více účtech Rohlík.cz)",
    schema: ENTITY_FIELDS.map(([name, , domain]) => ({
      name,
      selector: { entity: { filter: { integration: DOMAIN, domain } } },
    })),
  },
];
const EDITOR_LABELS = {
  show_logo: "Logo Rohlíku vlevo",
  compact_ordered: "Úsporný pruh při objednávce (40 px, plná výška až kurýr vyjede)",
  number_weight: "Písmo čísel",
  ...Object.fromEntries(ENTITY_FIELDS.map(([name, label]) => [name, label])),
};

class RohlikCourierCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = config || {};
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  _render() {
    if (!this._hass || !this._config) return;
    if (!this._form) {
      const note = document.createElement("p");
      note.style.cssText = "margin:0 0 12px;color:var(--secondary-text-color);font-size:14px";
      note.textContent =
        "Karta si entity integrace Rohlík.cz najde sama. Vyber je jen tehdy, když máš víc účtů.";
      this._form = document.createElement("ha-form");
      this._form.schema = EDITOR_SCHEMA;
      this._form.computeLabel = (schema) => EDITOR_LABELS[schema.name] ?? schema.title ?? schema.name;
      this._form.addEventListener("value-changed", (ev) => {
        const config = { ...ev.detail.value };
        for (const [key, value] of Object.entries(config)) {
          if (value === "" || value === undefined || value === null) delete config[key];
        }
        // Keep defaults out of the YAML.
        if (config.show_logo === true) delete config.show_logo;
        if (config.number_weight === "regular") delete config.number_weight;
        if (config.compact_ordered === false) delete config.compact_ordered;
        this._config = config;
        this.dispatchEvent(new CustomEvent("config-changed", { detail: { config }, bubbles: true, composed: true }));
      });
      this.append(note, this._form);
    }
    this._form.hass = this._hass;
    this._form.data = { show_logo: true, compact_ordered: false, number_weight: "regular", ...this._config };
  }
}

if (!customElements.get("rohlik-courier-card-editor")) {
  customElements.define("rohlik-courier-card-editor", RohlikCourierCardEditor);
}

if (!customElements.get("rohlik-courier-card")) {
  console.info(`%c ROHLIK-COURIER-CARD %c ${VERSION} `, "color:#fff;background:#03a9f4", "");
  customElements.define("rohlik-courier-card", RohlikCourierCard);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: "rohlik-courier-card",
    name: "Rohlík – doručení",
    description: "Pruh s objednávkou a odpočtem příjezdu kurýra; zobrazí se jen při objednávce.",
    documentationURL: "https://github.com/hruskin/rohlik-courier-card",
    preview: true,
  });
}
