# Budget Tracker

A personal, single-file budget tracker. No build step, no backend — just open `index.html`.

## Features
- Month-by-month tracker with recurring incoming/outgoing items, weekly budget, savings and stocks & shares contributions
- Automatic cascading: a change in any month ripples forward through every month already created after it
- Quick Add for one-off spends/income, with a collapsible log
- Calendar view for navigating between tracked months
- Trend charts: Actual vs Projected net worth, savings/stocks pot growth
- Multiple profiles on the same browser (e.g. for a partner's separate budget)
- Optional cloud sync (Firebase Firestore) so data survives clearing the browser and can follow you across devices — off by default, opt in per profile in Settings

## Privacy
All data lives in your browser's local storage by default. Nothing is uploaded anywhere unless you explicitly turn on Cloud Sync for a profile in Settings, and even then only that profile's data (under a private, unguessable sync code) is stored — never shared or listable by anyone else.
