(() => {
  const $ = (sel, el = document) => el.querySelector(sel);
  const app = $("#app");
  const toastEl = $("#toast");

  const KEY_USERS = "lc91_users";
  const KEY_SESS = "lc91_session";

  const INTERVALS = { "30s": 30, "1Min": 60, "3Min": 180, "5Min": 300 };
  const AMOUNTS = [1, 10, 100, 1000];
  const QTYS = [1, 5, 10, 20, 50, 100];

  const GAMES = {
    lobby: [
      { id: "wingo", name: "Win Go", img: "public/img/card-wingo.jpg" },
      { id: "k3", name: "K3", img: "public/img/card-k3.jpg" },
      { id: "5d", name: "5D", img: "public/img/card-5d.jpg" },
      { id: "trx", name: "TRX WinGo", img: "public/img/card-trx.jpg" },
    ],
    mini: [
      { id: "aviator", name: "Aviator", img: "public/img/card-aviator.jpg" },
      { id: "mines", name: "Mines", img: "public/img/card-mines.jpg" },
      { id: "plinko", name: "Plinko", ph: "PLINKO", bg: "linear-gradient(135deg,#00c6ff,#0072ff)" },
      { id: "dice", name: "Dice", ph: "DICE", bg: "linear-gradient(135deg,#f7971e,#ffd200)" },
    ],
    slots: [
      { id: "slots", name: "Super Ace", img: "public/img/card-slots.jpg" },
      { id: "slots", name: "Fortune 777", ph: "777", bg: "linear-gradient(135deg,#c31432,#240b36)" },
      { id: "slots", name: "Money Coming", ph: "MONEY", bg: "linear-gradient(135deg,#f5af19,#f12711)" },
      { id: "slots", name: "Gems", ph: "GEMS", bg: "linear-gradient(135deg,#11998e,#38ef7d)" },
    ],
    card: [
      { id: "patti", name: "Teen Patti", ph: "3 PATTI", bg: "linear-gradient(135deg,#0f9b0f,#000)" },
      { id: "andar", name: "Andar Bahar", ph: "A / B", bg: "linear-gradient(135deg,#373b44,#4286f4)" },
      { id: "dt", name: "Dragon Tiger", ph: "D / T", bg: "linear-gradient(135deg,#e52d27,#b31217)" },
    ],
    fish: [
      { id: "fish", name: "Royal Fishing", ph: "FISHING", bg: "linear-gradient(135deg,#2193b0,#6dd5ed)" },
      { id: "fish", name: "Jackpot Fish", ph: "JACKPOT", bg: "linear-gradient(135deg,#42275a,#734b6d)" },
    ],
  };

  const state = {
    page: "splash",
    tab: "login",
    cat: "lobby",
    user: null,
    banner: 0,
    wingoMode: "1Min",
    histTab: "history",
    bet: null,
    resultPop: null,
    pay: "UMoney-QR",
    depAmt: 100,
    aviator: { running: false, mult: 1, crash: 2, cashed: false, bet: 0 },
    mines: null,
    slots: ["7️⃣", "💎", "🍒"],
    tick: 0,
  };

  function loadUsers() {
    try { return JSON.parse(localStorage.getItem(KEY_USERS) || "[]"); }
    catch { return []; }
  }
  function saveUsers(list) { localStorage.setItem(KEY_USERS, JSON.stringify(list)); }
  function persistUser() {
    if (!state.user) return;
    const list = loadUsers();
    const i = list.findIndex((u) => u.phone === state.user.phone);
    if (i >= 0) list[i] = state.user;
    else list.push(state.user);
    saveUsers(list);
    localStorage.setItem(KEY_SESS, state.user.phone);
  }

  function toast(msg) {
    toastEl.innerHTML = `<div class="toast">${msg}</div>`;
    setTimeout(() => { toastEl.innerHTML = ""; }, 1800);
  }

  function money(n) {
    return "₹" + Number(n || 0).toFixed(2);
  }

  function hashNum(str, mod = 10) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0) % mod;
  }

  function colorOf(n) {
    if (n === 0) return ["r", "v"];
    if (n === 5) return ["g", "v"];
    if ([1, 3, 7, 9].includes(n)) return ["g"];
    return ["r"];
  }
  function ballClass(n) {
    if (n === 0) return "rv";
    if (n === 5) return "gv";
    if ([1, 3, 7, 9].includes(n)) return "g";
    return "r";
  }
  function sizeOf(n) { return n >= 5 ? "big" : "small"; }

  function periodInfo(sec) {
    const now = Math.floor(Date.now() / 1000);
    const id = Math.floor(now / sec);
    const remaining = sec - (now % sec);
    const start = id * sec * 1000;
    const d = new Date(start);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const seq = String(id % 1000000).padStart(6, "0");
    const period = `${y}${m}${day}${seq}`;
    return { id, remaining, period };
  }

  function resultFor(period) {
    return hashNum("91club-" + period, 10);
  }

  function history(sec, count = 10) {
    const now = Math.floor(Date.now() / 1000);
    const id = Math.floor(now / sec);
    const rows = [];
    for (let i = 1; i <= count; i++) {
      const pid = id - i;
      const start = pid * sec * 1000;
      const d = new Date(start);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      const seq = String(pid % 1000000).padStart(6, "0");
      const period = `${y}${m}${day}${seq}`;
      const n = resultFor(period);
      rows.push({ period, n, colors: colorOf(n), size: sizeOf(n) });
    }
    return rows;
  }

  function credit(amount, note) {
    state.user.balance = +(state.user.balance + amount).toFixed(2);
    state.user.txns.unshift({
      id: Date.now(),
      note,
      amount,
      at: new Date().toISOString(),
      bal: state.user.balance,
    });
    persistUser();
  }

  function debit(amount, note) {
    if (state.user.balance < amount) return false;
    state.user.balance = +(state.user.balance - amount).toFixed(2);
    state.user.txns.unshift({
      id: Date.now(),
      note,
      amount: -amount,
      at: new Date().toISOString(),
      bal: state.user.balance,
    });
    persistUser();
    return true;
  }

  function uidFromPhone(phone) {
    return "91" + String(hashNum(phone, 100000000)).padStart(8, "0");
  }

  function register(phone, pass, invite) {
    const users = loadUsers();
    if (users.some((u) => u.phone === phone)) return "Phone already registered";
    if (!/^\d{10}$/.test(phone)) return "Enter valid 10-digit mobile";
    if (pass.length < 6) return "Password min 6 characters";
    const user = {
      phone,
      pass,
      uid: uidFromPhone(phone),
      nick: "Member" + phone.slice(-4),
      balance: 20,
      invite: invite || "122417877882",
      myInvite: String(100000000000 + hashNum(phone, 899999999999)),
      vip: 0,
      bets: [],
      txns: [{ id: Date.now(), note: "Sign-up bonus", amount: 20, at: new Date().toISOString(), bal: 20 }],
      checkin: null,
      createdAt: Date.now(),
    };
    users.push(user);
    saveUsers(users);
    state.user = user;
    persistUser();
    return null;
  }

  function login(phone, pass) {
    const users = loadUsers();
    const u = users.find((x) => x.phone === phone && x.pass === pass);
    if (!u) return "Invalid mobile or password";
    state.user = u;
    persistUser();
    return null;
  }

  function demoLogin() {
    const phone = "9999999999";
    const users = loadUsers();
    let u = users.find((x) => x.phone === phone);
    if (!u) {
      register(phone, "demo123", "91CLUB");
      state.user.balance = 500;
      state.user.nick = "Demo Player";
      persistUser();
      return;
    }
    if (u.balance < 50) u.balance = 500;
    state.user = u;
    persistUser();
  }

  /* ---------- payout ---------- */
  function settleWingoBet(bet, n) {
    const colors = colorOf(n);
    let mult = 0;
    if (bet.kind === "color") {
      if (bet.pick === "green" && colors.includes("g")) mult = n === 5 ? 1.5 : 2;
      if (bet.pick === "red" && colors.includes("r")) mult = n === 0 ? 1.5 : 2;
      if (bet.pick === "violet" && colors.includes("v")) mult = 4.5;
    } else if (bet.kind === "number" && Number(bet.pick) === n) {
      mult = 9;
    } else if (bet.kind === "size") {
      if (bet.pick === sizeOf(n)) mult = 2;
    }
    return +(bet.stake * mult).toFixed(2);
  }

  function maybeSettle() {
    if (!state.user) return;
    const now = Date.now();
    let changed = false;
    state.user.bets.forEach((b) => {
      if (b.status !== "pending") return;
      const elapsed = now - b.placedAt;
      if (elapsed < b.lockMs) return;
      if (b.game === "wingo" || b.game === "trx") {
        const n = resultFor(b.period);
        const win = settleWingoBet(b, n);
        b.status = win > 0 ? "win" : "lose";
        b.result = n;
        b.payout = win;
        if (win > 0) {
          state.user.balance = +(state.user.balance + win).toFixed(2);
          state.user.txns.unshift({ id: Date.now() + Math.random(), note: `Win ${b.game.toUpperCase()}`, amount: win, at: new Date().toISOString(), bal: state.user.balance });
        }
        changed = true;
      } else if (b.game === "k3") {
        const d1 = hashNum(b.period + "a", 6) + 1;
        const d2 = hashNum(b.period + "b", 6) + 1;
        const d3 = hashNum(b.period + "c", 6) + 1;
        const sum = d1 + d2 + d3;
        let win = 0;
        if (b.pick === "big" && sum >= 11) win = b.stake * 2;
        if (b.pick === "small" && sum <= 10) win = b.stake * 2;
        if (b.pick === "odd" && sum % 2 === 1) win = b.stake * 2;
        if (b.pick === "even" && sum % 2 === 0) win = b.stake * 2;
        b.status = win > 0 ? "win" : "lose";
        b.result = `${d1}${d2}${d3}`;
        b.payout = win;
        if (win > 0) {
          state.user.balance = +(state.user.balance + win).toFixed(2);
          state.user.txns.unshift({ id: Date.now() + Math.random(), note: "Win K3", amount: win, at: new Date().toISOString(), bal: state.user.balance });
        }
        changed = true;
      } else if (b.game === "5d") {
        const digits = [0, 1, 2, 3, 4].map((i) => hashNum(b.period + "d" + i, 10));
        const sum = digits.reduce((a, c) => a + c, 0);
        let win = 0;
        if (b.pick === "big" && sum >= 23) win = b.stake * 2;
        if (b.pick === "small" && sum < 23) win = b.stake * 2;
        if (b.pick === "odd" && sum % 2 === 1) win = b.stake * 2;
        if (b.pick === "even" && sum % 2 === 0) win = b.stake * 2;
        b.status = win > 0 ? "win" : "lose";
        b.result = digits.join("");
        b.payout = win;
        if (win > 0) {
          state.user.balance = +(state.user.balance + win).toFixed(2);
          state.user.txns.unshift({ id: Date.now() + Math.random(), note: "Win 5D", amount: win, at: new Date().toISOString(), bal: state.user.balance });
        }
        changed = true;
      }
    });
    if (changed) persistUser();
  }

  function placeBet(game, kind, pick, stake, period, lockMs) {
    if (!state.user) return;
    if (stake < 1) return toast("Min bet ₹1");
    if (!debit(stake, `Bet ${game} ${pick}`)) return toast("Insufficient balance");
    state.user.bets.unshift({
      id: Date.now(),
      game, kind, pick, stake, period, lockMs,
      placedAt: Date.now(),
      status: "pending",
      payout: 0,
    });
    persistUser();
    toast("Bet placed");
    state.bet = null;
    render();
  }

  /* ---------- icons ---------- */
  const ico = {
    home: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="14" rx="2"/><path d="M8 21h8M12 18v3"/></svg>`,
    promo: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.2" fill="currentColor"/></svg>`,
    gift: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="8" width="18" height="13" rx="2"/><path d="M12 8v13M3 12h18M12 8c0-3 2-5 4.2-5 1.6 0 2.8 1.4 1.8 3C17 8 12 8 12 8zM12 8c0-3-2-5-4.2-5-1.6 0-2.8 1.4-1.8 3C7 8 12 8 12 8z"/></svg>`,
    wallet: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="6" width="20" height="14" rx="2"/><path d="M16 12h4v4h-4a2 2 0 0 1 0-4z"/></svg>`,
    user: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 20c1.5-4 5-6 8-6s6.5 2 8 6"/></svg>`,
    down: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg>`,
    chat: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><path d="M21 12a8 8 0 0 1-8 8H7l-4 3V12a8 8 0 1 1 18 0z"/></svg>`,
    refresh: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-2.6-6.3M21 3v6h-6"/></svg>`,
  };

  function nav(active) {
    return `
      <nav class="nav m-only">
        <button data-go="promo" class="${active === "promo" ? "on" : ""}">${ico.promo}<span>Promotion</span></button>
        <button data-go="activity" class="${active === "activity" ? "on" : ""}">${ico.gift}<span>Activity</span></button>
        <button data-go="home" class="home-fab">${ico.home}<span>Home</span></button>
        <button data-go="wallet" class="${active === "wallet" ? "on" : ""}">${ico.wallet}<span>Wallet</span></button>
        <button data-go="account" class="${active === "account" ? "on" : ""}">${ico.user}<span>Account</span></button>
      </nav>
      <button class="chat-fab m-only" data-go="support">${ico.chat}</button>
    `;
  }

  function siteHeader(active) {
    const links = state.user
      ? [
          ["home", "Home"],
          ["wallet", "Wallet"],
          ["promo", "Promotion"],
          ["activity", "Activity"],
          ["support", "Support"],
        ]
      : [
          ["landing", "Home"],
          ["landing", "Games"],
          ["about", "About"],
          ["support", "Help"],
        ];
    return `
      <header class="site-head">
        <div class="bar">
          <button class="brand-row" data-go="${state.user ? "home" : "landing"}" style="border:0;background:transparent;cursor:pointer">
            <img src="public/img/logo.png" alt="" />
            <div class="brand-name">91 CLUB</div>
          </button>
          <nav class="site-links">
            ${links.map(([id, label]) => `<button data-go="${id}" class="${active === id ? "on" : ""}">${label}</button>`).join("")}
            ${state.user ? `
              <button data-cat="lobby">Lottery</button>
              <button data-cat="mini">Mini</button>
              <button data-cat="slots">Slots</button>
            ` : ""}
          </nav>
          <div class="site-actions">
            ${state.user ? `
              <span class="head-bal">${money(state.user.balance)}</span>
              <button class="btn-ghost" data-go="withdraw">Withdraw</button>
              <button class="btn-sm" data-go="deposit">Deposit</button>
              <button class="avatar-sm" data-go="account">${(state.user.nick || "M").slice(0, 1)}</button>
            ` : `
              <button class="btn-ghost" data-go="auth">Log in</button>
              <button class="btn-sm" id="heroReg" data-go="auth">Register</button>
            `}
          </div>
        </div>
      </header>
    `;
  }

  function siteFooter() {
    return `
      <footer class="site-foot">
        <div class="bar">
          <div>
            <h5>91 Club</h5>
            <p>Entertainment lottery lobby inspired by 91 Club. WinGo, K3, 5D, Aviator and slots — virtual play only. 18+.</p>
          </div>
          <div>
            <h5>Games</h5>
            <button data-go="wingo">WinGo</button>
            <button data-go="k3">K3 Lottery</button>
            <button data-go="aviator">Aviator</button>
            <button data-go="mines">Mines</button>
          </div>
          <div>
            <h5>Account</h5>
            <button data-go="wallet">Wallet</button>
            <button data-go="promo">Promotion</button>
            <button data-go="activity">Activity</button>
            <button data-go="support">Customer service</button>
          </div>
          <div>
            <h5>Legal</h5>
            <button data-go="about">About this demo</button>
            <p>No real deposits. Not affiliated with the official 91 Club brand.</p>
          </div>
        </div>
        <div class="foot-copy">© ${new Date().getFullYear()} Lottery-777 · Demo website · Virtual coins only</div>
      </footer>
    `;
  }

  function ball(n, cls = "") {
    return `<span class="ball ${ballClass(n)} ${cls}">${n}</span>`;
  }

  /* ---------- views ---------- */
  function viewSplash() {
    return `
      <div class="splash">
        <img class="splash-logo" src="public/img/logo.png" alt="91" />
        <h1>91 CLUB</h1>
        <p>WinGo · Lottery · Mini Games</p>
      </div>
    `;
  }

  function viewAuth() {
    const t = state.tab;
    const form = `
      <div class="tabs-pill">
        <button class="${t === "login" ? "on" : ""}" data-tab="login">Log in</button>
        <button class="${t === "reg" ? "on" : ""}" data-tab="reg">Register</button>
      </div>
      <div class="field"><label>Phone number</label><input id="ph" type="tel" maxlength="10" placeholder="Enter 10-digit mobile" /></div>
      <div class="field"><label>Password</label><input id="pw" type="password" placeholder="Password" /></div>
      ${t === "reg" ? `
        <div class="field"><label>Confirm password</label><input id="pw2" type="password" placeholder="Re-enter password" /></div>
        <div class="field"><label>Invite code</label><input id="inv" placeholder="122417877882" /></div>
      ` : ""}
      <button class="btn btn-orange" id="authGo">${t === "login" ? "Log in" : "Register"}</button>
      <div class="demo-row">
        <button class="btn btn-outline" id="demo">Play Demo ₹500</button>
      </div>
      <p class="hint">Entertainment demo · virtual balance only · 18+</p>
    `;
    return `
      <div class="screen">
        ${siteHeader("auth")}
        <div class="auth-web">
          <div class="auth-side">
            <h2>Play on the web</h2>
            <p>WinGo, lottery, Aviator and slots in your browser. New members get a ₹20 welcome bonus.</p>
          </div>
          <div class="auth-panel">
            <div class="m-only auth-hero" style="border-radius:16px;margin-bottom:16px;padding:20px">
              <div class="brand"><img src="public/img/logo.png" alt="" /><h1>91 CLUB</h1></div>
              <p>Login or register with your mobile number.</p>
            </div>
            ${form}
          </div>
        </div>
        ${siteFooter()}
      </div>
    `;
  }

  function viewLanding() {
    const all = [...GAMES.lobby, ...GAMES.mini, ...GAMES.slots];
    return `
      <div class="landing">
        ${siteHeader("landing")}
        <section class="hero">
          <div class="bar">
            <div>
              <p style="letter-spacing:2px;font-size:12px;font-weight:700;opacity:.8;margin:0 0 10px">91 CLUB WEB</p>
              <h1>Lottery, WinGo &amp; mini games in your browser</h1>
              <p>Same club lobby — now a full website. Register free, get virtual bonus coins, and play WinGo, K3, Aviator, Mines and slots.</p>
              <div class="hero-cta">
                <button class="btn btn-orange" data-go="auth">Register now</button>
                <button class="btn btn-outline" id="demo">Play Demo ₹500</button>
              </div>
            </div>
            <div class="hero-art"><img src="public/img/banner-slots.jpg" alt="91 Club games" /></div>
          </div>
        </section>
        <div class="stats">
          <div class="stat"><b>20+</b><span>Games in one lobby</span></div>
          <div class="stat"><b>₹20</b><span>Welcome bonus</span></div>
          <div class="stat"><b>30s</b><span>Fastest WinGo round</span></div>
          <div class="stat"><b>18+</b><span>Entertainment only</span></div>
        </div>
        <section class="web-sec">
          <h2>Popular games</h2>
          <p class="lead">Tap a card to log in and start a virtual round</p>
          <div class="web-grid">${all.map(gameCard).join("")}</div>
        </section>
        <section class="web-sec">
          <h2>How it works</h2>
          <div class="steps">
            <div class="step"><i>1</i><h4>Create account</h4><p>Use your mobile number or jump in with the demo wallet.</p></div>
            <div class="step"><i>2</i><h4>Get coins</h4><p>Welcome bonus, gift code 91WELCOME, or demo deposit.</p></div>
            <div class="step"><i>3</i><h4>Pick a game</h4><p>WinGo colours, Aviator crash, Mines, slots and more.</p></div>
            <div class="step"><i>4</i><h4>Track wallet</h4><p>Every bet and win is saved in this browser.</p></div>
          </div>
        </section>
        <section class="web-sec">
          <h2>FAQ</h2>
          <div class="faq">
            <details open><summary>Is this the real 91 Club?</summary><p>No. This is an entertainment clone for the Lottery-777 project. Virtual balance only.</p></details>
            <details><summary>Can I withdraw real money?</summary><p>No. Deposit and withdraw buttons only move play-money in local storage.</p></details>
            <details><summary>Does it work on phone and PC?</summary><p>Yes. Phone keeps the app layout. Desktop is a full website with header, lobby and footer.</p></details>
          </div>
        </section>
        ${siteFooter()}
      </div>
    `;
  }

  function gameCard(g) {
    const media = g.img
      ? `<img src="${g.img}" alt="${g.name}" />`
      : `<div class="gph" style="background:${g.bg}">${g.ph}</div>`;
    return `<button class="gcard" data-go="${g.id}">${media}<span class="gname">${g.name}</span></button>`;
  }

  function viewHome() {
    const banners = ["public/img/banner-slots.jpg", "public/img/banner-bonus.jpg"];
    const list = GAMES[state.cat] || GAMES.lobby;
    const titles = { lobby: "Lottery", mini: "Mini games", slots: "Slots", card: "Card", fish: "Fishing" };
    const subs = {
      lobby: "The games are independently developed by our team, fun, fair, and safe",
      mini: "Quick rounds · Aviator, Mines, Plinko and more",
      slots: "Spin popular titles and chase the jackpot",
      card: "Teen Patti, Andar Bahar, Dragon Tiger",
      fish: "Arcade fishing with big multipliers",
    };
    const webSections = ["lobby", "mini", "slots", "card", "fish"].map((c) => `
      <div class="sec">
        <h3>${titles[c]}</h3>
        <p class="sub">${subs[c]}</p>
        <div class="ggrid">${GAMES[c].map(gameCard).join("")}</div>
      </div>
    `).join("");
    return `
      <div class="screen">
        ${siteHeader("home")}
        <div class="topbar m-only">
          <div class="brand-row">
            <img src="public/img/logo.png" alt="" />
            <div class="brand-name">91 CLUB</div>
          </div>
          <button class="icon-btn" data-act="download">${ico.down}</button>
        </div>
        <div class="scroll">
          <div class="banner-wrap">
            <div class="banner"><img src="${banners[state.banner % 2]}" alt="banner" /></div>
          </div>
          <div class="dots m-only"><i class="${state.banner % 2 === 0 ? "on" : ""}"></i><i class="${state.banner % 2 === 1 ? "on" : ""}"></i></div>
          <div class="marquee"><span>Member****8121 won ₹2,450 on WinGo · Member****3309 won ₹8,100 on Aviator · Fast withdrawal · 24×7 support</span></div>
          <div class="wallet-card">
            <div class="wallet-top">
              <div>
                <div class="w-label">🪙 Wallet balance</div>
                <div class="w-amt">${money(state.user.balance)} <button data-act="refresh">${ico.refresh}</button></div>
              </div>
              <div class="w-actions">
                <button class="btn-withdraw" data-go="withdraw">Withdraw</button>
                <button class="btn-deposit" data-go="deposit">Deposit</button>
              </div>
            </div>
          </div>
          <div class="promo-row">
            <div class="promo wheel" data-go="wheel"><div class="p-ico">🎡</div><div><b>Wheel of fortune</b><span>Daily free spin</span></div></div>
            <div class="promo vip" data-go="vip"><div class="p-ico">👑</div><div><b>VIP privileges</b><span>Level ${state.user.vip} rewards</span></div></div>
          </div>
          <div class="cats m-only">
            ${["lobby", "mini", "slots", "card", "fish"].map((c) => `
              <button class="cat ${state.cat === c ? "on" : ""}" data-cat="${c}">
                <span class="ci">${{ lobby: "🏠", mini: "🎮", slots: "7️⃣", card: "🃏", fish: "🐟" }[c]}</span>
                ${{ lobby: "Lobby", mini: "Mini game", slots: "Slots", card: "Card", fish: "Fishing" }[c]}
              </button>
            `).join("")}
          </div>
          <div class="sec m-only">
            <h3>${titles[state.cat]}</h3>
            <p class="sub">${subs[state.cat]}</p>
            <div class="ggrid">${list.map(gameCard).join("")}</div>
          </div>
          <div class="web-only">${webSections}</div>
          <p class="notice">This is a look-alike entertainment clone of 91 Club. All balances are virtual play-money. No real deposits or withdrawals.</p>
        </div>
        ${nav("home")}
        ${siteFooter()}
      </div>
    `;
  }

  function viewWingo(trx = false) {
    const sec = INTERVALS[state.wingoMode];
    const p = periodInfo(sec);
    const last = history(sec, 5);
    const locked = p.remaining <= 5;
    const hist = history(sec, 10);
    const mine = (state.user.bets || []).filter((b) => (trx ? b.game === "trx" : b.game === "wingo")).slice(0, 12);
    const title = trx ? "TRX WinGo" : "WinGo " + state.wingoMode;
    return `
      <div class="screen wingo">
        <div class="ghead">
          <button class="back" data-go="home">‹</button>
          <b>${title}</b>
          <div class="bal">${money(state.user.balance)}</div>
        </div>
        <div class="scroll" style="position:relative">
          <div class="modes">
            ${Object.keys(INTERVALS).map((k) => `<button class="${state.wingoMode === k ? "on" : ""}" data-mode="${k}">${k}</button>`).join("")}
          </div>
          <div class="ticket">
            <div class="t-row">
              <div class="t-left">
                <button class="how" data-act="howto">How to play</button>
                <div class="name">${trx ? "TRX " : ""}WinGo ${state.wingoMode}</div>
                <div class="balls">${last.map((r) => ball(r.n)).join("")}</div>
              </div>
              <div class="t-right">
                <div class="lab">Time remaining</div>
                <div class="flip">${flip(p.remaining)}</div>
                <div class="period">${p.period}</div>
              </div>
            </div>
          </div>
          <div style="position:relative">
            <div class="colors">
              <button class="cg" data-bet='{"kind":"color","pick":"green"}'>Green</button>
              <button class="cv" data-bet='{"kind":"color","pick":"violet"}'>Violet</button>
              <button class="cr" data-bet='{"kind":"color","pick":"red"}'>Red</button>
            </div>
            <div class="nums">
              ${[0,1,2,3,4,5,6,7,8,9].map((n) => `<button data-bet='{"kind":"number","pick":"${n}"}'>${ball(n, "lg")}</button>`).join("")}
            </div>
            <div class="bs">
              <button class="big" data-bet='{"kind":"size","pick":"big"}'>Big</button>
              <button class="small" data-bet='{"kind":"size","pick":"small"}'>Small</button>
            </div>
            ${locked ? `<div class="lock"><div class="cd">0${p.remaining}</div></div>` : ""}
          </div>
          <div class="hist-tabs">
            <button class="${state.histTab === "history" ? "on" : ""}" data-htab="history">Game history</button>
            <button class="${state.histTab === "chart" ? "on" : ""}" data-htab="chart">Chart</button>
            <button class="${state.histTab === "mine" ? "on" : ""}" data-htab="mine">My game</button>
          </div>
          ${state.histTab === "history" ? `
            <table class="table">
              <tr><th>Period</th><th>Number</th><th>Big/Small</th><th>Color</th></tr>
              ${hist.map((r) => `<tr>
                <td>${r.period.slice(-8)}</td>
                <td>${ball(r.n)}</td>
                <td>${r.size === "big" ? "Big" : "Small"}</td>
                <td>${r.colors.map((c) => c === "g" ? "Green" : c === "r" ? "Red" : "Violet").join("/")}</td>
              </tr>`).join("")}
            </table>` : ""}
          ${state.histTab === "chart" ? `
            <div style="padding:12px;display:flex;flex-wrap:wrap;gap:6px">${hist.map((r) => ball(r.n, "lg")).join("")}</div>
          ` : ""}
          ${state.histTab === "mine" ? `
            <table class="table">
              <tr><th>Period</th><th>Select</th><th>Amount</th><th>Result</th></tr>
              ${mine.length ? mine.map((b) => `<tr>
                <td>${String(b.period).slice(-8)}</td>
                <td>${b.pick}</td>
                <td>${money(b.stake)}</td>
                <td class="${b.status}">${b.status === "pending" ? "…" : b.status === "win" ? "+" + money(b.payout) : "Lose"}</td>
              </tr>`).join("") : `<tr><td colspan="4" class="empty">No bets yet</td></tr>`}
            </table>` : ""}
        </div>
        ${state.bet ? betSheet(trx ? "trx" : "wingo", p) : ""}
        ${state.resultPop || ""}
      </div>
    `;
  }

  function flip(sec) {
    const m = String(Math.floor(sec / 60)).padStart(2, "0");
    const s = String(sec % 60).padStart(2, "0");
    return [...m, ":", ...s].map((ch) => `<span>${ch}</span>`).join("");
  }

  function betSheet(game, p) {
    const b = state.bet;
    const stake = (b.amt || 10) * (b.qty || 1);
    const label = b.kind === "color" ? b.pick.toUpperCase() : b.kind === "size" ? b.pick.toUpperCase() : "Number " + b.pick;
    return `
      <div class="overlay" id="betOverlay">
        <div class="sheet">
          <h3>Bet · ${label}</h3>
          <div style="font-size:12px;color:#888;margin-bottom:8px">Amount</div>
          <div class="chip-row">
            ${AMOUNTS.map((a) => `<button class="chip ${(b.amt || 10) === a ? "on" : ""}" data-amt="${a}">₹${a}</button>`).join("")}
          </div>
          <div style="font-size:12px;color:#888">Quantity</div>
          <div class="qty">
            <button data-q="-">−</button>
            <input id="qty" value="${b.qty || 1}" readonly />
            <button data-q="+">+</button>
          </div>
          <div class="chip-row">
            ${QTYS.map((q) => `<button class="chip ${(b.qty || 1) === q ? "on" : ""}" data-setq="${q}">X${q}</button>`).join("")}
          </div>
          <div class="total"><span>Total</span><b>${money(stake)}</b></div>
          <div class="agree">I agree to the Presale rules · last 5s bets are locked</div>
          <button class="btn btn-orange" id="confirmBet" data-game="${game}" data-period="${p.period}" data-lock="${p.remaining * 1000}">Confirm</button>
        </div>
      </div>
    `;
  }

  function viewK3() {
    const sec = INTERVALS[state.wingoMode];
    const p = periodInfo(sec);
    const locked = p.remaining <= 5;
    const last = history(sec, 1)[0];
    const d1 = hashNum(last.period + "a", 6) + 1;
    const d2 = hashNum(last.period + "b", 6) + 1;
    const d3 = hashNum(last.period + "c", 6) + 1;
    return `
      <div class="screen wingo">
        <div class="ghead">
          <button class="back" data-go="home">‹</button>
          <b>K3 ${state.wingoMode}</b>
          <div class="bal">${money(state.user.balance)}</div>
        </div>
        <div class="scroll" style="position:relative">
          <div class="modes">
            ${Object.keys(INTERVALS).map((k) => `<button class="${state.wingoMode === k ? "on" : ""}" data-mode="${k}">${k}</button>`).join("")}
          </div>
          <div class="ticket">
            <div class="t-row">
              <div class="t-left">
                <div class="name">Last draw ${d1} + ${d2} + ${d3} = ${d1 + d2 + d3}</div>
                <div class="k3-dice"><div class="die">${d1}</div><div class="die">${d2}</div><div class="die">${d3}</div></div>
              </div>
              <div class="t-right">
                <div class="lab">Time remaining</div>
                <div class="flip">${flip(p.remaining)}</div>
                <div class="period">${p.period}</div>
              </div>
            </div>
          </div>
          <div style="position:relative">
            <div class="bs">
              <button class="big" data-bet='{"kind":"k3","pick":"big"}'>Big 11-18 · 2x</button>
              <button class="small" data-bet='{"kind":"k3","pick":"small"}'>Small 3-10 · 2x</button>
            </div>
            <div class="colors">
              <button class="cg" data-bet='{"kind":"k3","pick":"odd"}'>Odd · 2x</button>
              <button class="cv" data-bet='{"kind":"k3","pick":"even"}'>Even · 2x</button>
              <button class="cr" data-act="howto">Rules</button>
            </div>
            ${locked ? `<div class="lock"><div class="cd">0${p.remaining}</div></div>` : ""}
          </div>
        </div>
        ${state.bet ? betSheet("k3", p) : ""}
      </div>
    `;
  }

  function view5D() {
    const sec = INTERVALS[state.wingoMode];
    const p = periodInfo(sec);
    const locked = p.remaining <= 5;
    const lastP = history(sec, 1)[0].period;
    const digits = [0, 1, 2, 3, 4].map((i) => hashNum(lastP + "d" + i, 10));
    return `
      <div class="screen wingo">
        <div class="ghead">
          <button class="back" data-go="home">‹</button>
          <b>5D ${state.wingoMode}</b>
          <div class="bal">${money(state.user.balance)}</div>
        </div>
        <div class="scroll" style="position:relative">
          <div class="modes">
            ${Object.keys(INTERVALS).map((k) => `<button class="${state.wingoMode === k ? "on" : ""}" data-mode="${k}">${k}</button>`).join("")}
          </div>
          <div class="ticket">
            <div class="t-row">
              <div class="t-left">
                <div class="name">Last result</div>
                <div class="balls">${digits.map((n) => ball(n)).join("")}</div>
                <div class="name">Sum ${digits.reduce((a, c) => a + c, 0)}</div>
              </div>
              <div class="t-right">
                <div class="lab">Time remaining</div>
                <div class="flip">${flip(p.remaining)}</div>
                <div class="period">${p.period}</div>
              </div>
            </div>
          </div>
          <div style="position:relative">
            <div class="bs">
              <button class="big" data-bet='{"kind":"5d","pick":"big"}'>Sum Big ≥23</button>
              <button class="small" data-bet='{"kind":"5d","pick":"small"}'>Sum Small</button>
            </div>
            <div class="colors">
              <button class="cg" data-bet='{"kind":"5d","pick":"odd"}'>Odd</button>
              <button class="cv" data-bet='{"kind":"5d","pick":"even"}'>Even</button>
              <button class="cr" data-act="howto">Rules</button>
            </div>
            ${locked ? `<div class="lock"><div class="cd">0${p.remaining}</div></div>` : ""}
          </div>
        </div>
        ${state.bet ? betSheet("5d", p) : ""}
      </div>
    `;
  }

  function viewAviator() {
    const a = state.aviator;
    return `
      <div class="screen aviator">
        <div class="ghead">
          <button class="back" data-go="home">‹</button>
          <b>Aviator</b>
          <div class="bal">${money(state.user.balance)}</div>
        </div>
        <div class="scroll">
          <div class="sky">
            <div class="trail" style="width:${Math.min(90, 10 + a.mult * 18)}%;transform:rotate(-${Math.min(28, a.mult * 4)}deg)"></div>
            <div class="plane" style="left:${Math.min(78, 8 + a.mult * 16)}%;bottom:${Math.min(72, 12 + a.mult * 12)}%">✈️</div>
            <div class="mult ${a.crash && a.mult >= a.crash && !a.running ? "crash-txt" : ""}">
              ${a.running || a.mult > 1 ? a.mult.toFixed(2) + "x" : "START"}
            </div>
          </div>
          <div class="pad">
            <div class="chip-row">
              ${[10, 20, 50, 100, 200].map((n) => `<button class="chip ${(a.stake || 10) === n ? "on" : ""}" data-avstake="${n}">₹${n}</button>`).join("")}
            </div>
            ${!a.running
              ? `<button class="btn btn-orange" id="avBet">Bet ${money(a.stake || 10)}</button>`
              : a.cashed
                ? `<button class="btn btn-outline" disabled>Cashed ${a.mult.toFixed(2)}x</button>`
                : `<button class="btn btn-orange" id="avCash" style="background:#18b660">Cash out ${money((a.stake || 10) * a.mult)}</button>`
            }
            <p class="hint" style="color:#9ab">Cash out before the plane flies away. Virtual play only.</p>
          </div>
        </div>
      </div>
    `;
  }

  function viewMines() {
    if (!state.mines) {
      state.mines = {
        bombs: 3,
        stake: 10,
        opened: [],
        dead: false,
        cashed: false,
        grid: shuffleBombs(3),
      };
    }
    const m = state.mines;
    const gems = m.opened.length;
    const mult = +(1 + gems * 0.35).toFixed(2);
    return `
      <div class="screen light">
        <div class="ghead">
          <button class="back" data-go="home">‹</button>
          <b>Mines</b>
          <div class="bal">${money(state.user.balance)}</div>
        </div>
        <div class="scroll">
          <div class="pad" style="padding-top:12px">
            <div class="chip-row">
              ${[10, 20, 50, 100].map((n) => `<button class="chip ${m.stake === n ? "on" : ""}" data-mstake="${n}">₹${n}</button>`).join("")}
            </div>
            <div style="display:flex;justify-content:space-between;font-size:13px;margin:8px 0">
              <span>Gems ${gems}</span><b>${mult}x · next ${money(m.stake * mult)}</b>
            </div>
          </div>
          <div class="mines-grid">
            ${m.grid.map((cell, i) => {
              const open = m.opened.includes(i) || m.dead || m.cashed;
              const show = open ? (cell === "b" ? "💣" : "💎") : "";
              const cls = open ? (cell === "b" ? "bomb" : "gem") : "";
              return `<button class="tile ${cls} ${m.dead || m.cashed ? "off" : ""}" data-tile="${i}">${show}</button>`;
            }).join("")}
          </div>
          <div class="pad">
            ${m.dead || m.cashed
              ? `<button class="btn btn-orange" id="mReset">Play again</button>`
              : gems
                ? `<button class="btn btn-orange" id="mCash" style="background:#18b660">Cash out ${money(m.stake * mult)}</button>`
                : `<p class="hint">Tap tiles. Avoid bombs. Cash out anytime.</p>`
            }
          </div>
        </div>
      </div>
    `;
  }

  function shuffleBombs(n) {
    const arr = Array(25).fill("g");
    let left = n;
    while (left) {
      const i = Math.floor(Math.random() * 25);
      if (arr[i] === "g") { arr[i] = "b"; left--; }
    }
    return arr;
  }

  function viewSlots() {
    return `
      <div class="screen" style="background:linear-gradient(#4a0000,#1a0000)">
        <div class="ghead">
          <button class="back" data-go="home">‹</button>
          <b>Super Ace</b>
          <div class="bal">${money(state.user.balance)}</div>
        </div>
        <div class="scroll">
          <div class="reels">
            ${state.slots.map((s) => `<div class="reel">${s}</div>`).join("")}
          </div>
          <div class="pad">
            <div class="chip-row" style="justify-content:center">
              ${[5, 10, 20, 50].map((n) => `<button class="chip ${(state.slotStake || 10) === n ? "on" : ""}" data-sstake="${n}">₹${n}</button>`).join("")}
            </div>
            <button class="btn btn-orange" id="spin">SPIN</button>
            <p class="hint" style="color:#f8c">3 same symbols = 8x · 2 same = 2x</p>
          </div>
        </div>
      </div>
    `;
  }

  function simpleCardGame(id, title, a, b) {
    return `
      <div class="screen light">
        <div class="ghead">
          <button class="back" data-go="home">‹</button>
          <b>${title}</b>
          <div class="bal">${money(state.user.balance)}</div>
        </div>
        <div class="scroll">
          <div class="pad" style="padding-top:20px">
            <p class="sub" style="text-align:center">Pick a side. Instant result. 1.95x</p>
            <div class="chip-row" style="justify-content:center">
              ${[10, 20, 50, 100].map((n) => `<button class="chip ${(state.cardStake || 10) === n ? "on" : ""}" data-cstake="${n}">₹${n}</button>`).join("")}
            </div>
            <div class="promo-row">
              <button class="promo wheel" data-side="${a}" data-gid="${id}" style="justify-content:center;border:0;font:inherit;color:#fff"><b>${a}</b></button>
              <button class="promo vip" data-side="${b}" data-gid="${id}" style="justify-content:center;border:0;font:inherit;color:#fff"><b>${b}</b></button>
            </div>
            <div id="cardRes" class="empty"></div>
          </div>
        </div>
      </div>
    `;
  }

  function viewWallet() {
    const dep = state.user.txns.filter((t) => t.note.startsWith("Deposit")).reduce((s, t) => s + t.amount, 0);
    const wd = state.user.txns.filter((t) => t.note.startsWith("Withdraw")).reduce((s, t) => s + Math.abs(t.amount), 0);
    return `
      <div class="screen">
        <div class="page-head"><span></span><span>Wallet</span><span></span></div>
        <div class="scroll">
          <div class="acc-hero" style="border-radius:0 0 20px 20px">
            <div style="font-size:12px;opacity:.9">Total balance</div>
            <div style="font-size:32px;font-weight:800;margin:6px 0">${money(state.user.balance)}</div>
            <div class="acc-stats">
              <div><span>Total deposit</span><b>${money(dep)}</b></div>
              <div><span>Total withdraw</span><b>${money(wd)}</b></div>
            </div>
            <div class="w-actions" style="margin-top:14px">
              <button class="btn-withdraw" data-go="withdraw" style="flex:1;background:#fff">Withdraw</button>
              <button class="btn-deposit" data-go="deposit" style="flex:1">Deposit</button>
            </div>
          </div>
          <div class="menu">
            <button data-go="history">Game history <span>›</span></button>
            <button data-go="txns">Transaction history <span>›</span></button>
            <button data-go="deposit">Recharge <span>›</span></button>
            <button data-go="withdraw">Withdraw <span>›</span></button>
          </div>
          <p class="notice">Virtual wallet for this demo. Buttons simulate recharge / withdraw instantly.</p>
        </div>
        ${nav("wallet")}
      </div>
    `;
  }

  function viewDeposit() {
    const methods = ["UMoney-QR", "RsPay-QR", "Super-QR", "ICE-QR", "HAP-QR", "YayaPay-QR"];
    return `
      <div class="screen">
        <div class="page-head">
          <button class="back" data-go="wallet">‹</button>
          <span>Deposit</span>
          <button class="link" data-go="txns">History</button>
        </div>
        <div class="scroll">
          <div class="pay-grid">
            ${methods.map((m) => `
              <button class="pay ${state.pay === m ? "on" : ""}" data-pay="${m}">
                <b>${m}</b><span>Balance:100 - 50K</span>
              </button>`).join("")}
          </div>
          <div class="sec"><h3>Deposit amount</h3></div>
          <div class="amt-grid">
            ${[100, 200, 300, 500, 1000, 2000, 5000, 10000, 20000].map((n) => `
              <button class="amt ${state.depAmt === n ? "on" : ""}" data-dep="${n}">₹ ${n}</button>
            `).join("")}
          </div>
          <div class="pad">
            <div style="font-size:12px;color:#888;margin-bottom:10px">Recharge Method: ${state.pay}</div>
            <button class="btn btn-orange" id="doDep">Deposit ${money(state.depAmt)}</button>
            <p class="hint">Demo credit · no real payment is taken</p>
          </div>
        </div>
      </div>
    `;
  }

  function viewWithdraw() {
    return `
      <div class="screen">
        <div class="page-head">
          <button class="back" data-go="wallet">‹</button>
          <span>Withdraw</span>
          <button class="link" data-go="txns">History</button>
        </div>
        <div class="scroll">
          <div class="wallet-card">
            <div class="w-label">Available balance</div>
            <div class="w-amt">${money(state.user.balance)}</div>
          </div>
          <div class="pad">
            <div class="field"><label>UPI / Bank</label><input id="upi" placeholder="name@upi" /></div>
            <div class="field"><label>Amount (min ₹110)</label><input id="wdAmt" type="number" placeholder="110" /></div>
            <button class="btn btn-orange" id="doWd">Withdraw</button>
            <p class="hint">Demo only · request is marked completed instantly in history</p>
          </div>
        </div>
      </div>
    `;
  }

  function viewPromo() {
    return `
      <div class="screen">
        <div class="page-head"><span></span><span>Promotion</span><span></span></div>
        <div class="scroll">
          <div class="acc-hero">
            <div style="font-size:12px;opacity:.9">Yesterday's commission</div>
            <div style="font-size:28px;font-weight:800">₹0.00</div>
            <div style="margin-top:10px;font-size:13px">Invite code <b>${state.user.myInvite}</b>
              <button class="link" id="copyInv" style="color:#fff">Copy</button>
            </div>
          </div>
          <div class="act-card">
            <div class="ic" style="background:#fff1f0">👥</div>
            <div><h4>Invite friends</h4><p>Earn up to 60% rebate when they play (demo)</p></div>
          </div>
          <div class="act-card">
            <div class="ic" style="background:#f3e8ff">🎁</div>
            <div><h4>Invitation bonus</h4><p>₹100 extra when a friend first deposits ₹1,000</p></div>
          </div>
          <div class="act-card">
            <div class="ic" style="background:#e8fff1">📈</div>
            <div><h4>My commission</h4><p>Team · Subordinate · Direct</p></div>
          </div>
        </div>
        ${nav("promo")}
      </div>
    `;
  }

  function viewActivity() {
    const today = new Date().toDateString();
    const done = state.user.checkin === today;
    return `
      <div class="screen">
        <div class="page-head"><span></span><span>Activity</span><span></span></div>
        <div class="scroll">
          <div class="act-card">
            <div class="ic" style="background:#fff4e0">📅</div>
            <div style="flex:1">
              <h4>Daily check-in</h4>
              <p>${done ? "Already claimed today" : "Get ₹5 virtual bonus"}</p>
            </div>
            <button class="btn btn-orange" style="width:auto;padding:8px 14px;border-radius:10px" id="checkin" ${done ? "disabled" : ""}>${done ? "Done" : "Claim"}</button>
          </div>
          <div class="act-card">
            <div class="ic" style="background:#e8f4ff">🎫</div>
            <div style="flex:1">
              <h4>Gift code</h4>
              <p>Try code <b>91WELCOME</b></p>
            </div>
          </div>
          <div class="pad">
            <div class="field"><input id="gift" placeholder="Enter gift code" /></div>
            <button class="btn btn-orange" id="redeem">Redeem</button>
          </div>
          <div class="act-card" data-go="wheel">
            <div class="ic" style="background:#ffe8f0">🎡</div>
            <div><h4>Wheel of fortune</h4><p>Spin for extra coins</p></div>
          </div>
        </div>
        ${nav("activity")}
      </div>
    `;
  }

  function viewAccount() {
    return `
      <div class="screen">
        <div class="scroll" style="padding-bottom:80px">
          <div class="acc-hero">
            <div class="acc-user">
              <div class="avatar">${state.user.nick.slice(0, 1)}</div>
              <div>
                <b>${state.user.nick}</b>
                <div class="uid">UID ${state.user.uid} · VIP${state.user.vip}</div>
                <div class="uid">${state.user.phone}</div>
              </div>
            </div>
            <div class="acc-stats">
              <div><span>Balance</span><b>${money(state.user.balance)}</b></div>
              <div><span>Total bets</span><b>${state.user.bets.length}</b></div>
            </div>
          </div>
          <div class="menu">
            <button data-go="history">Game history <span>›</span></button>
            <button data-go="txns">Transactions <span>›</span></button>
            <button data-go="vip">VIP <span>›</span></button>
            <button data-go="support">Customer service <span>›</span></button>
            <button data-go="about">About 91 Club <span>›</span></button>
            <button id="logout" style="color:#f2413a">Log out <span>›</span></button>
          </div>
        </div>
        ${nav("account")}
      </div>
    `;
  }

  function viewList(title, rows) {
    return `
      <div class="screen">
        <div class="page-head"><button class="back" data-go="account">‹</button><span>${title}</span><span></span></div>
        <div class="scroll">
          ${rows || `<div class="empty">Nothing here yet</div>`}
        </div>
      </div>
    `;
  }

  function viewHistory() {
    const rows = state.user.bets.slice(0, 40).map((b) => `
      <div class="act-card">
        <div class="ic" style="background:#f6f6f6">${b.game[0].toUpperCase()}</div>
        <div style="flex:1">
          <h4>${b.game.toUpperCase()} · ${b.pick}</h4>
          <p>${new Date(b.placedAt).toLocaleString()} · ${b.status}</p>
        </div>
        <b class="${b.status}">${b.status === "win" ? "+" + money(b.payout) : money(b.stake)}</b>
      </div>
    `).join("");
    return viewList("Game history", rows);
  }

  function viewTxns() {
    const rows = state.user.txns.slice(0, 50).map((t) => `
      <div class="act-card">
        <div class="ic" style="background:#f6f6f6">₹</div>
        <div style="flex:1">
          <h4>${t.note}</h4>
          <p>${new Date(t.at).toLocaleString()}</p>
        </div>
        <b class="${t.amount >= 0 ? "win" : "lose"}">${t.amount >= 0 ? "+" : ""}${money(t.amount)}</b>
      </div>
    `).join("");
    return viewList("Transactions", rows);
  }

  function viewWheel() {
    return `
      <div class="screen light">
        <div class="ghead"><button class="back" data-go="home">‹</button><b>Wheel of fortune</b><div class="bal">${money(state.user.balance)}</div></div>
        <div class="scroll">
          <div style="text-align:center;padding:28px 12px">
            <div style="font-size:88px;line-height:1">🎡</div>
            <p>Daily free spin · virtual prize</p>
            <button class="btn btn-orange" id="spinWheel" style="max-width:240px;margin:0 auto">SPIN</button>
            <div id="wheelRes" class="empty"></div>
          </div>
        </div>
      </div>
    `;
  }

  function viewVip() {
    return `
      <div class="screen">
        <div class="page-head"><button class="back" data-go="home">‹</button><span>VIP</span><span></span></div>
        <div class="scroll">
          <div class="acc-hero"><b>VIP ${state.user.vip}</b><p style="opacity:.9;font-size:13px">Level up by playing more games. Rewards are virtual.</p></div>
          ${[0,1,2,3,4,5].map((v) => `
            <div class="act-card">
              <div class="ic" style="background:#f3e8ff">👑</div>
              <div><h4>VIP ${v}</h4><p>Weekly bonus ₹${v * 20} · higher rebate</p></div>
            </div>
          `).join("")}
        </div>
      </div>
    `;
  }

  function viewSupport() {
    return `
      <div class="screen">
        <div class="page-head"><button class="back" data-go="home">‹</button><span>Customer service</span><span></span></div>
        <div class="scroll">
          <div class="act-card"><div class="ic">💬</div><div><h4>24×7 Help</h4><p>This demo has no live agents. All games use virtual coins.</p></div></div>
          <div class="act-card"><div class="ic">📘</div><div><h4>How to play WinGo</h4><p>Bet Green / Red / Violet / 0-9 / Big-Small before the timer ends.</p></div></div>
          <div class="act-card"><div class="ic">⚠️</div><div><h4>Responsible play</h4><p>18+ only. This is not real-money gambling.</p></div></div>
        </div>
      </div>
    `;
  }

  function viewAbout() {
    return `
      <div class="screen">
        <div class="page-head"><button class="back" data-go="account">‹</button><span>About</span><span></span></div>
        <div class="scroll pad">
          <p>91 Club style lottery lobby with WinGo, K3, 5D, Aviator, Mines, slots and wallet flows.</p>
          <p>Built as an entertainment clone. No real payments, no official 91 Club affiliation.</p>
        </div>
      </div>
    `;
  }

  function viewPlinko() {
    return `
      <div class="screen light">
        <div class="ghead"><button class="back" data-go="home">‹</button><b>Plinko</b><div class="bal">${money(state.user.balance)}</div></div>
        <div class="scroll pad" style="padding-top:20px;text-align:center">
          <div style="font-size:64px">🪙</div>
          <p>Drop a ball. Multipliers 0.2x – 8x</p>
          <div class="chip-row" style="justify-content:center">
            ${[10,20,50].map((n)=>`<button class="chip ${(state.plinkoStake||10)===n?"on":""}" data-pl="${n}">₹${n}</button>`).join("")}
          </div>
          <button class="btn btn-orange" id="dropPlinko">Drop</button>
          <div id="plRes" class="empty"></div>
        </div>
      </div>
    `;
  }

  function viewDice() {
    return `
      <div class="screen light">
        <div class="ghead"><button class="back" data-go="home">‹</button><b>Dice</b><div class="bal">${money(state.user.balance)}</div></div>
        <div class="scroll pad" style="padding-top:20px;text-align:center">
          <div class="k3-dice"><div class="die" id="dA">?</div><div class="die" id="dB">?</div></div>
          <div class="chip-row" style="justify-content:center">
            ${[10,20,50].map((n)=>`<button class="chip ${(state.diceStake||10)===n?"on":""}" data-ds="${n}">₹${n}</button>`).join("")}
          </div>
          <div class="promo-row">
            <button class="promo wheel" id="diceBig" style="justify-content:center;border:0;color:#fff"><b>Big 7-12</b></button>
            <button class="promo vip" id="diceSmall" style="justify-content:center;border:0;color:#fff"><b>Small 2-6</b></button>
          </div>
          <div id="diceRes" class="empty"></div>
        </div>
      </div>
    `;
  }

  function viewHow() {
    return `
      <div class="overlay" id="howOverlay">
        <div class="sheet">
          <h3>How to play</h3>
          <p style="font-size:13px;line-height:1.5;color:#555">
            A number 0–9 is drawn each round.<br/>
            <b>Green</b> 1,3,7,9 pays 2x (5 pays 1.5x)<br/>
            <b>Red</b> 2,4,6,8 pays 2x (0 pays 1.5x)<br/>
            <b>Violet</b> 0 or 5 pays 4.5x<br/>
            <b>Number</b> exact digit pays 9x<br/>
            <b>Big</b> 5–9 · <b>Small</b> 0–4 pays 2x<br/>
            Last 5 seconds betting is locked.
          </p>
          <button class="btn btn-orange" id="closeHow">OK</button>
        </div>
      </div>
    `;
  }

  /* ---------- render ---------- */
  function render(opts = {}) {
    const y = opts.keepScroll ? window.scrollY : null;
    maybeSettle();
    const p = state.page;
    const titles = {
      landing: "91 Club — Lottery & Games",
      auth: "Log in · 91 Club",
      home: "Lobby · 91 Club",
      wingo: "WinGo · 91 Club",
      wallet: "Wallet · 91 Club",
    };
    document.title = titles[p] || "91 Club — Lottery & Games";
    let html = "";
    if (p === "splash") html = viewSplash();
    else if (p === "landing") html = viewLanding();
    else if (p === "auth") html = viewAuth();
    else if (!state.user && (p === "about" || p === "support")) html = p === "about" ? viewAbout() : viewSupport();
    else if (!state.user) html = viewAuth();
    else if (p === "home") html = viewHome();
    else if (p === "wingo") html = viewWingo(false);
    else if (p === "trx") html = viewWingo(true);
    else if (p === "k3") html = viewK3();
    else if (p === "5d") html = view5D();
    else if (p === "aviator") html = viewAviator();
    else if (p === "mines") html = viewMines();
    else if (p === "slots") html = viewSlots();
    else if (p === "patti") html = simpleCardGame("patti", "Teen Patti", "Play", "Pack");
    else if (p === "andar") html = simpleCardGame("andar", "Andar Bahar", "Andar", "Bahar");
    else if (p === "dt") html = simpleCardGame("dt", "Dragon Tiger", "Dragon", "Tiger");
    else if (p === "fish") html = simpleCardGame("fish", "Royal Fishing", "Fire", "Auto");
    else if (p === "wallet") html = viewWallet();
    else if (p === "deposit") html = viewDeposit();
    else if (p === "withdraw") html = viewWithdraw();
    else if (p === "promo") html = viewPromo();
    else if (p === "activity") html = viewActivity();
    else if (p === "account") html = viewAccount();
    else if (p === "history") html = viewHistory();
    else if (p === "txns") html = viewTxns();
    else if (p === "wheel") html = viewWheel();
    else if (p === "vip") html = viewVip();
    else if (p === "support") html = viewSupport();
    else if (p === "about") html = viewAbout();
    else if (p === "plinko") html = viewPlinko();
    else if (p === "dice") html = viewDice();
    else html = viewHome();

    if (state.showHow) html += viewHow();
    app.innerHTML = html;
    const screen = app.querySelector(".screen, .landing");
    const skipChrome = ["splash", "landing", "auth"].includes(state.page);
    if (screen && !skipChrome && !screen.querySelector(".site-head")) {
      screen.insertAdjacentHTML("afterbegin", siteHeader(state.page));
    }
    if (screen && !skipChrome && !screen.querySelector(".site-foot")) {
      screen.insertAdjacentHTML("beforeend", siteFooter());
    }
    bind();
    if (y != null) window.scrollTo(0, y);
  }

  const PUBLIC = ["landing", "auth", "splash", "about", "support"];

  function go(page) {
    if (!state.user && !PUBLIC.includes(page)) {
      state.next = page;
      page = "auth";
    }
    if (state.user && page === "landing") page = "home";
    state.page = page;
    state.bet = null;
    state.showHow = false;
    const hash = "#/" + page;
    if (location.hash !== hash) location.hash = hash;
    else render();
    window.scrollTo(0, 0);
  }

  function bind() {
    app.querySelectorAll("[data-go]").forEach((el) => {
      el.onclick = (e) => { e.stopPropagation(); go(el.dataset.go); };
    });
    app.querySelectorAll("[data-tab]").forEach((el) => {
      el.onclick = () => { state.tab = el.dataset.tab; render(); };
    });
    app.querySelectorAll("[data-cat]").forEach((el) => {
      el.onclick = () => {
        state.cat = el.dataset.cat;
        if (state.page !== "home") go("home");
        else render();
      };
    });
    app.querySelectorAll("[data-mode]").forEach((el) => {
      el.onclick = () => { state.wingoMode = el.dataset.mode; render(); };
    });
    app.querySelectorAll("[data-htab]").forEach((el) => {
      el.onclick = () => { state.histTab = el.dataset.htab; render(); };
    });
    app.querySelectorAll("[data-bet]").forEach((el) => {
      el.onclick = () => {
        const sec = INTERVALS[state.wingoMode];
        if (periodInfo(sec).remaining <= 5) return toast("Betting locked");
        state.bet = { ...JSON.parse(el.dataset.bet), amt: 10, qty: 1 };
        render();
      };
    });
    app.querySelectorAll("[data-amt]").forEach((el) => {
      el.onclick = () => { state.bet.amt = +el.dataset.amt; render(); };
    });
    app.querySelectorAll("[data-setq]").forEach((el) => {
      el.onclick = () => { state.bet.qty = +el.dataset.setq; render(); };
    });
    app.querySelectorAll("[data-q]").forEach((el) => {
      el.onclick = () => {
        state.bet.qty = Math.max(1, (state.bet.qty || 1) + (el.dataset.q === "+" ? 1 : -1));
        render();
      };
    });
    const overlay = $("#betOverlay");
    if (overlay) overlay.onclick = (e) => { if (e.target === overlay) { state.bet = null; render(); } };
    const cb = $("#confirmBet");
    if (cb) cb.onclick = () => {
      const stake = (state.bet.amt || 10) * (state.bet.qty || 1);
      const kind = state.bet.kind === "k3" || state.bet.kind === "5d" ? "size" : state.bet.kind;
      placeBet(cb.dataset.game, kind, state.bet.pick, stake, cb.dataset.period, +cb.dataset.lock);
    };

    const authGo = $("#authGo");
    if (authGo) authGo.onclick = () => {
      const ph = $("#ph").value.trim();
      const pw = $("#pw").value;
      if (state.tab === "login") {
        const err = login(ph, pw);
        if (err) return toast(err);
        go(state.next || "home");
        state.next = null;
      } else {
        const pw2 = $("#pw2").value;
        if (pw !== pw2) return toast("Passwords do not match");
        const err = register(ph, pw, $("#inv").value.trim());
        if (err) return toast(err);
        toast("Welcome bonus ₹20 credited");
        go(state.next || "home");
        state.next = null;
      }
    };
    const demo = $("#demo");
    if (demo) demo.onclick = () => { demoLogin(); go(state.next || "home"); state.next = null; };
    app.querySelectorAll("[data-go='auth']").forEach((el) => {
      if (/register/i.test(el.textContent || "")) {
        const prev = el.onclick;
        el.onclick = (e) => { state.tab = "reg"; if (prev) prev(e); };
      }
    });

    const logout = $("#logout");
    if (logout) logout.onclick = () => {
      localStorage.removeItem(KEY_SESS);
      state.user = null;
      go("auth");
    };

    app.querySelectorAll("[data-pay]").forEach((el) => {
      el.onclick = () => { state.pay = el.dataset.pay; render(); };
    });
    app.querySelectorAll("[data-dep]").forEach((el) => {
      el.onclick = () => { state.depAmt = +el.dataset.dep; render(); };
    });
    const doDep = $("#doDep");
    if (doDep) doDep.onclick = () => {
      credit(state.depAmt, "Deposit " + state.pay);
      toast("Deposit success " + money(state.depAmt));
      go("wallet");
    };
    const doWd = $("#doWd");
    if (doWd) doWd.onclick = () => {
      const amt = +$("#wdAmt").value;
      if (amt < 110) return toast("Min withdraw ₹110");
      if (!debit(amt, "Withdraw UPI")) return toast("Insufficient balance");
      toast("Withdraw submitted");
      go("wallet");
    };

    const checkin = $("#checkin");
    if (checkin) checkin.onclick = () => {
      state.user.checkin = new Date().toDateString();
      credit(5, "Daily check-in");
      toast("+₹5 check-in bonus");
      render();
    };
    const redeem = $("#redeem");
    if (redeem) redeem.onclick = () => {
      const code = ($("#gift").value || "").trim().toUpperCase();
      if (code === "91WELCOME") {
        if (state.user.gifted) return toast("Already redeemed");
        state.user.gifted = true;
        credit(50, "Gift code 91WELCOME");
        toast("+₹50 gift credited");
        render();
      } else toast("Invalid code");
    };
    const copyInv = $("#copyInv");
    if (copyInv) copyInv.onclick = async () => {
      try { await navigator.clipboard.writeText(state.user.myInvite); toast("Copied"); }
      catch { toast(state.user.myInvite); }
    };

    app.querySelectorAll("[data-act='howto']").forEach((el) => {
      el.onclick = () => { state.showHow = true; render(); };
    });
    const closeHow = $("#closeHow");
    if (closeHow) closeHow.onclick = () => { state.showHow = false; render(); };
    const howOverlay = $("#howOverlay");
    if (howOverlay) howOverlay.onclick = (e) => { if (e.target === howOverlay) { state.showHow = false; render(); } };

    app.querySelectorAll("[data-act='download']").forEach((el) => {
      el.onclick = () => toast("Open in browser · Add to Home Screen");
    });
    app.querySelectorAll("[data-act='refresh']").forEach((el) => {
      el.onclick = () => { persistUser(); toast("Balance refreshed"); render(); };
    });

    /* aviator */
    app.querySelectorAll("[data-avstake]").forEach((el) => {
      el.onclick = () => { state.aviator.stake = +el.dataset.avstake; render(); };
    });
    const avBet = $("#avBet");
    if (avBet) avBet.onclick = () => {
      const stake = state.aviator.stake || 10;
      if (!debit(stake, "Bet Aviator")) return toast("Insufficient balance");
      const crash = +(1.1 + Math.pow(Math.random(), 2.2) * 8).toFixed(2);
      state.aviator = { running: true, mult: 1, crash, cashed: false, bet: stake, stake };
      render();
      runAviator();
    };
    const avCash = $("#avCash");
    if (avCash) avCash.onclick = () => {
      if (!state.aviator.running || state.aviator.cashed) return;
      state.aviator.cashed = true;
      state.aviator.running = false;
      const win = +(state.aviator.bet * state.aviator.mult).toFixed(2);
      credit(win, "Win Aviator");
      toast("Cashed out " + money(win));
      render();
    };

    /* mines */
    app.querySelectorAll("[data-mstake]").forEach((el) => {
      el.onclick = () => {
        if (state.mines && state.mines.opened.length) return;
        state.mines.stake = +el.dataset.mstake;
        render();
      };
    });
    app.querySelectorAll("[data-tile]").forEach((el) => {
      el.onclick = () => {
        const m = state.mines;
        if (m.dead || m.cashed) return;
        const i = +el.dataset.tile;
        if (m.opened.includes(i)) return;
        if (m.opened.length === 0) {
          if (!debit(m.stake, "Bet Mines")) return toast("Insufficient balance");
        }
        if (m.grid[i] === "b") {
          m.dead = true;
          m.opened.push(i);
          toast("Boom! You hit a mine");
        } else {
          m.opened.push(i);
        }
        render();
      };
    });
    const mCash = $("#mCash");
    if (mCash) mCash.onclick = () => {
      const m = state.mines;
      const mult = +(1 + m.opened.length * 0.35).toFixed(2);
      const win = +(m.stake * mult).toFixed(2);
      m.cashed = true;
      credit(win, "Win Mines");
      toast("Cashed " + money(win));
      render();
    };
    const mReset = $("#mReset");
    if (mReset) mReset.onclick = () => { state.mines = null; render(); };

    /* slots */
    app.querySelectorAll("[data-sstake]").forEach((el) => {
      el.onclick = () => { state.slotStake = +el.dataset.sstake; render(); };
    });
    const spin = $("#spin");
    if (spin) spin.onclick = () => {
      const stake = state.slotStake || 10;
      if (!debit(stake, "Bet Slots")) return toast("Insufficient balance");
      const sym = ["7️⃣", "💎", "🍒", "🍋", "⭐"];
      state.slots = [0, 1, 2].map(() => sym[Math.floor(Math.random() * sym.length)]);
      let win = 0;
      if (state.slots[0] === state.slots[1] && state.slots[1] === state.slots[2]) win = stake * 8;
      else if (state.slots[0] === state.slots[1] || state.slots[1] === state.slots[2] || state.slots[0] === state.slots[2]) win = stake * 2;
      if (win) { credit(win, "Win Slots"); toast("You won " + money(win)); }
      else toast("Try again");
      render();
    };

    /* card games */
    app.querySelectorAll("[data-side]").forEach((el) => {
      el.onclick = () => {
        const stake = state.cardStake || 10;
        if (!debit(stake, "Bet " + el.dataset.gid)) return toast("Insufficient balance");
        const winSide = Math.random() > 0.5 ? el.dataset.side : "other";
        const box = $("#cardRes");
        if (winSide === el.dataset.side) {
          const win = +(stake * 1.95).toFixed(2);
          credit(win, "Win " + el.dataset.gid);
          if (box) box.textContent = "You won " + money(win);
          toast("You won " + money(win));
        } else {
          if (box) box.textContent = "You lost this round";
          toast("You lost");
        }
        const bal = document.querySelector(".ghead .bal");
        if (bal) bal.textContent = money(state.user.balance);
      };
    });
    app.querySelectorAll("[data-cstake]").forEach((el) => {
      el.onclick = () => { state.cardStake = +el.dataset.cstake; render(); };
    });

    const spinWheel = $("#spinWheel");
    if (spinWheel) spinWheel.onclick = () => {
      const key = "wheel-" + new Date().toDateString();
      if (state.user[key]) return toast("Come back tomorrow");
      state.user[key] = true;
      const prize = [1, 2, 5, 8, 0, 15][Math.floor(Math.random() * 6)];
      if (prize) credit(prize, "Wheel prize");
      const box = $("#wheelRes");
      if (box) box.textContent = prize ? "You won ₹" + prize : "Better luck next time";
      toast(prize ? "+₹" + prize : "No prize");
      persistUser();
    };

    app.querySelectorAll("[data-pl]").forEach((el) => {
      el.onclick = () => { state.plinkoStake = +el.dataset.pl; render(); };
    });
    const drop = $("#dropPlinko");
    if (drop) drop.onclick = () => {
      const stake = state.plinkoStake || 10;
      if (!debit(stake, "Bet Plinko")) return toast("Insufficient balance");
      const mults = [0.2, 0.5, 1, 1.2, 2, 4, 8, 0.5, 0.2];
      const m = mults[Math.floor(Math.random() * mults.length)];
      const win = +(stake * m).toFixed(2);
      if (win) credit(win, "Win Plinko");
      const box = $("#plRes");
      if (box) box.textContent = m + "x · " + money(win);
      toast(m + "x");
    };

    app.querySelectorAll("[data-ds]").forEach((el) => {
      el.onclick = () => { state.diceStake = +el.dataset.ds; render(); };
    });
    const rollDice = (pick) => {
      const stake = state.diceStake || 10;
      if (!debit(stake, "Bet Dice")) return toast("Insufficient balance");
      const a = 1 + Math.floor(Math.random() * 6);
      const b = 1 + Math.floor(Math.random() * 6);
      const sum = a + b;
      const da = $("#dA"); const db = $("#dB");
      if (da) da.textContent = a;
      if (db) db.textContent = b;
      const big = sum >= 7;
      const won = (pick === "big" && big) || (pick === "small" && !big);
      if (won) {
        credit(stake * 1.95, "Win Dice");
        toast("Sum " + sum + " · You won");
      } else toast("Sum " + sum + " · You lost");
    };
    const diceBig = $("#diceBig");
    if (diceBig) diceBig.onclick = () => rollDice("big");
    const diceSmall = $("#diceSmall");
    if (diceSmall) diceSmall.onclick = () => rollDice("small");
  }

  function runAviator() {
    const step = () => {
      const a = state.aviator;
      if (!a.running) return;
      a.mult = +(a.mult + 0.06 + a.mult * 0.012).toFixed(2);
      if (a.mult >= a.crash) {
        a.running = false;
        a.mult = a.crash;
        if (!a.cashed) toast("Flew away at " + a.crash.toFixed(2) + "x");
        render();
        return;
      }
      render({ keepScroll: true });
      setTimeout(step, 120);
    };
    setTimeout(step, 120);
  }

  window.addEventListener("hashchange", () => {
    const page = (location.hash.replace(/^#\/?/, "") || (state.user ? "home" : "landing"));
    if (!page || page === state.page) return;
    if (!state.user && !PUBLIC.includes(page)) {
      state.page = "auth";
      render();
      return;
    }
    state.page = page === "landing" && state.user ? "home" : page;
    state.bet = null;
    render();
  });

  /* boot */
  const sess = localStorage.getItem(KEY_SESS);
  if (sess) {
    const u = loadUsers().find((x) => x.phone === sess);
    if (u) state.user = u;
  }
  const startHash = location.hash.replace(/^#\/?/, "");
  if (startHash && startHash !== "splash") {
    state.page = (!state.user && !PUBLIC.includes(startHash)) ? "auth" : startHash;
    if (state.user && state.page === "landing") state.page = "home";
  }

  render();
  setTimeout(() => {
    if (state.page === "splash") {
      go(state.user ? "home" : "landing");
    }
  }, 1200);

  setInterval(() => {
    state.tick++;
    if (state.tick % 5 === 0) state.banner = (state.banner + 1) % 2;
    if (["home", "wingo", "trx", "k3", "5d"].includes(state.page)) render({ keepScroll: true });
    else maybeSettle();
  }, 1000);
})();
