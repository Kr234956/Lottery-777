# 91 Club — Lottery 777

A full website (desktop + tablet + phone) inspired by **91 Club**: public landing page, login, lobby, WinGo, K3, 5D, Aviator, Mines, slots, wallet, promotion and account.

All balances are **virtual play-money**. There are no real payments, no UPI collection, and no affiliation with the official 91 Club product.

## Play

1. Open the app in a browser (phone width looks best).
2. **Register** with a 10-digit number, or tap **Play Demo ₹500**.
3. New accounts get a ₹20 welcome bonus. Gift code: `91WELCOME` (+₹50).

## Games

| Game | How it works |
| --- | --- |
| **WinGo / TRX WinGo** | Timed rounds (30s / 1 / 3 / 5 min). Bet Green, Violet, Red, 0–9, Big/Small. |
| **K3** | Three dice. Bet Big/Small/Odd/Even on the sum. |
| **5D** | Five digits. Bet on the sum. |
| **Aviator** | Multiplier climbs — cash out before the plane flies away. |
| **Mines** | Open gems, avoid bombs, cash out any time. |
| **Slots / Plinko / Dice / Cards** | Instant virtual rounds. |

WinGo payouts match the common club rules: Green/Red 2× (1.5× on 0/5), Violet 4.5×, number 9×, Big/Small 2×. Last 5 seconds of a round are locked.

## Run locally

```bash
python3 -m http.server 3000 --bind 0.0.0.0
```

Then open `http://localhost:3000`.

Data is stored in the browser (`localStorage`). 18+ entertainment only.
