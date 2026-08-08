# Wimpy Cooperations — Full Company Script

*Everything to know about the company, the products, the ownership, and where it's headed — written to be read straight through or used as a reference/pitch script.*

---

## Who We Are

Wimpy Cooperations is a Lagos, Nigeria-based software studio. The company is owned by **Agoye Godson-David**, who holds a **50% stake**, alongside Ibrahim Samuel. The company's guiding line, used across every product and every piece of marketing: *"Built software, not buzzwords."* Nothing shipped under the Wimpy name is built to sound impressive — it's built to actually work for the people using it.

The company's website is wimpy-corp.com.ng, and the hiring/affiliate portal — where new team members and affiliate marketers apply — lives at wimpy-corp.com.ng/careers.html.

---

## The Core Idea Behind Everything

Most small software companies build products one at a time, each starting from zero — a new login system, a new payment integration, a new user base to grow from nothing. Wimpy Cooperations was built the opposite way. Underneath every product sits one shared foundation:

- **WimpyID** — one identity. A single account works across every Wimpy product. Live at id.wimpy-corp.com.ng.
- **WimpyPay** — one wallet. A single subscription and payment system, tied to WimpyID, that every product bills through. Live at pay.wimpy-corp.com.ng.
- **WimpyAI** — one AI layer. A shared AI service, built on the OpenRouter API, that any product plugs into rather than each building its own AI integration from scratch. Live at wimpyai.onrender.com.

This means every new product Wimpy Cooperations launches gets cheaper and faster to build than the one before it — no new login system, no new payment integration, no new AI integration. That's the actual competitive advantage: not any single product, but the machine that makes every future product easier to build.

---

## The Live Products

**WimpSchool** (wimpschool.netlify.app) — School management software for Nigerian schools: attendance, fees, and student records in one place. Sold as a subscription, priced per school by student count. The audience is school proprietors and administrators.

**WimpyBooks** (wimpybooks.netlify.app) — A subscription reading platform. Readers get unlimited access to books for one subscription price, or can buy individual books. Currently being migrated fully onto WimpyID and WimpyPay, with a security and stability cleanup underway (fixing things like unsafe old authentication code and how book files are stored).

**WimpDrop** (wimpdrop.com.ng) — Not a delivery service, despite the name suggesting logistics — it's a subscription e-commerce storefront built around recurring product drops. Subscribers get early or exclusive access to new releases.

**Eaudeyplay** (eaudeyplay.com) — An entertainment app aimed at a younger, mobile-first audience, monetized through subscription.

**Wimpcooperation** (wimpy-corp.com.ng) — The company's own hiring and affiliate application portal, living at wimpy-corp.com.ng/careers.html. This is where developer roles and affiliate marketing opportunities are posted and applied for.

**WimpyPrep** (wimyprep.netlify.app) — A JAMB/WAEC exam prep app, internally nicknamed "The Sprint" for its energetic, gamified design (indigo, lime green, and gold). It includes real practice mode, mock exams, AI-powered weak-area targeting (powered by WimpyAI), daily streaks, a referral system, a leaderboard, year-based question filtering (recent years 2023-2026 reserved for paying subscribers), and a live head-to-head Battle mode where two students compete on the same question set in real time. Questions are currently sourced from ALOC, a free Nigerian question-bank API, with a plan to move to a paid, higher-quality source or original content over time. This is considered the safest bet of the two flagship products, because the demand is guaranteed — millions of Nigerian students sit these exams every single year, no market has to be created.

---

## The Two Flagship Products Being Built Right Now

*

**WimpyCreators** — A creator monetization platform, internally nicknamed "The Stage" for its warm, celebratory design (deep plum, coral, and gold). It lets fans tip and pay recurring memberships to Nigerian creators directly, with creators able to withdraw real money to their bank accounts via Paystack. This one is being built specifically because it reuses WimpyPay's existing wallet infrastructure directly — no new payment system required — and it comes with a built-in growth loop, since every creator who joins effectively promotes the platform to their own audience.

---

## Ideas Being Held for Later

A few more product ideas exist but are deliberately not started yet:

- **An AI meme/skit generator** for Nigerian humor, built on WimpyAI — the cheapest, fastest shot at organic viral attention.
- **WimpyBeats** — a distribution and tools platform for Afrobeats artists. This has the highest potential for fame of any idea on the list, but it depends more on relationships and hustle with real artists than on pure software building.
- **WimpyRooms** — live audio community rooms, similar to Twitter Spaces, monetized through WimpyPay.

These are being held back on purpose — the company would rather finish WimpyPrep and WimpyCreators properly than spread thin across too many half-built things at once.

---

## The Longer-Term Bet, Also Paused on Purpose

Eventually, WimpyID and WimpyPay could be opened up as a service other companies pay to use — letting any outside business add "Login with WimpyID" to their own app, or take a cut of transactions processed through WimpyPay (using Paystack's Subaccount/Transaction Split feature so Wimpy Cooperations never has to become its own licensed payment processor). This is a real, viable direction — essentially becoming a smaller, Nigeria-focused version of what Auth0 and Stripe do — but it's intentionally on hold until the current product lineup is stable and proven.

---

## How the Company Actually Operates Day to Day

Development happens with the help of GitHub Copilot, working inside each product's own repository. Because Copilot starts fresh in every session with no memory of other repos, every build prompt for a new feature explicitly explains what WimpyID, WimpyPay, and WimpyAI already provide, so nothing gets rebuilt from scratch by accident.

Every product shares the same underlying Supabase project — one database, with each product's own tables clearly prefixed (like `wp_` for WimpyPrep or `book_` for WimpyBooks) so nothing collides. Row Level Security is required on every table, without exception.

The company has also been actively investing in security and stability — several serious issues have been found and fixed across the products over time, including exposed real API keys and database credentials sitting unprotected in a repository, cross-site scripting vulnerabilities, and payment flows that could have let people get free access to paid features. Catching and fixing these before real users are affected has been treated as a genuine priority, not an afterthought.

---

## The Team

Wimpy Cooperations is owned by Agoye Godson-David (50% stake) and Ibrahim Samuel. A partnership agreement covering equity, roles, vesting, and exit terms has been drafted between them. Beyond the two owners, the company is looking to hire a Social Media/Advertising/Account Manager to run the day-to-day marketing and ad campaigns across the product family, likely starting as a part-time or contract role given the company's current stage.

---

## Where Things Stand Right Now

The immediate priorities are: finishing WimpyBooks' migration onto the shared WimpyID/WimpyPay infrastructure, stabilizing WimpyPrep (including its new live Battle mode), and then beginning the WimpyCreators build. A broader marketing push — including social media accounts, ad campaigns, and outreach — is planned to properly begin once the budget for it becomes available, with free groundwork (account setup, organic content, community outreach) happening in the meantime.

---

*This script reflects the company as it stands today — update it as products ship, as the team grows, and as strategy shifts.*
