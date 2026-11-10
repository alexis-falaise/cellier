# Cellier — product brief

Household pantry / basement inventory app for French households. Working name: **Cellier**.

## Platform decision

PWA, mobile-first, designed for iOS (iPhone 13 → iPhone 15 Pro). Native is used only if every constraint
(push notifications, multi-member distribution, real-phone testing) can be met for free — see
`docs/research/01-native-vs-pwa.md` for the verification.

## Functionalities

- Barcode scanner for products
- Reference of products available in French supermarkets (primary: E.Leclerc, Carrefour; long-conservation
  items and household products)
- Logging items by scanning; input the number of logged items once recognized
- Auto-fill of referenced properties: weight / volume / number of elements, price, category
- Default categories (vegetables, fruits, fish, cleaning, hygiene, juice, wine…), overridable
- Categories with icons and colors
- Inventory: searchable, sortable, groupable by item, category, recency, price, quantity
- Withdrawal through barcode scanning
- Multi-pantry: a household can have several pantries, each with its own inventory
- Multi-tenant: a household has several members and one owner
- Google authentication
- Running-low notifications
- Running-low items view on the homepage
- Live suggestions for the next groceries list, with a potential date

## Design constraints

- Elaborated design system
- Ultra-minimalist UI, clean accent colors, Apple inspiration — Apple Design Award grade
  (Apple design, Emil Kowalski, taste, impeccable)
- Phone haptics and motion response
- All elements transition naturally through GPU-accelerated spring motion

## UX constraints

- Offline support with deferred send and conflict management
- Background workers
- Notifications

## Technical constraints

- Tested on a real phone
- Deployed to Vercel (new project), GitHub repo connected
- Supabase DB with realtime, free project
- Blazing fast: optimistic updates, indexed queries, clean architecture, Linear-style state management
  (local-first object store, transaction queue, realtime deltas)

## Orchestration

- Research: Haiku agents → `docs/research/NN-topic.md`
- Design / UX: Opus agents → `docs/design/`
- Implementation: Opus agents, driven from `docs/architecture/`
