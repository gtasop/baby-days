# Baby Days

A shared sleep and feeding log for a baby, made for two tired parents and a phone
held in one hand at 3 a.m.

Both parents sign in with their own Google account. Whoever logs a nap or a feed,
the other sees it on their phone straight away.

## What it does

### Today

- **Sleep card.** Shows whether the baby is asleep or awake, and for how long.
  Tap **Start sleep** when the baby falls asleep and **Woke up** when they wake.
- **Feed card.** Shows how long ago the last feed was and what kind it was.
  - **Breast** starts a timer; tap **Stop feeding** when done.
  - **Bottle** asks for the amount in ml.
  - **Solids** logs a solids meal.
- **Last 24 hours.** Total sleep, number of feeds and bottle ml, with a timeline
  bar showing sleep blocks and feed times across the day.
- **Log.** Every entry, grouped by day with a daily total of sleep and feeds.
  Each entry shows the profile photo of the parent who logged it. Tap an entry
  to edit its times, add a note or delete it.
- **+ Add entry.** Log a sleep or feed after the fact, with start and end times.

Timers are shared, so one parent can start a nap and the other can end it.

### Trends

Switch between the last **7 days** and **30 days**:

- Average sleep per day, split into night (19:00–07:00) and day sleep.
- Average feeds per day and bottle ml per day.
- Longest sleep in the period.
- Typical time between feeds and average nap length.
- Bar charts of sleep per day (night and day) and feeds per day.

Averages count only full days since you started logging, so the first week isn't
dragged down by empty days.

### Sharing

- Each baby has its own list of people who can see and add to its log.
- Invite someone from **Sharing** by entering their Google email address. Next time
  they sign in, they see the invitation and tap **Join** (or **Decline**).
- Pending invitations can be cancelled, and members can be removed.
- More than one baby is supported; switch between them at the top.

### Everyday use

- **Stays signed in** on each phone after the first Google sign-in.
- **Works offline.** Entries made without signal sync when the phone is back online.
- **Installs to the home screen** with its own icon and opens full-screen.
- **Light and dark mode** follow the phone's setting.

## Privacy and access

Access is enforced by Firestore security rules (`firestore.rules`) on Google's
servers, not just by the app:

- Only signed-in members of a baby can read or write that baby's logs.
- An invited person can only join or decline. They can't change anything else
  until they've joined.
- Only the parent who added a baby can delete it.

Each member's name and profile photo are stored with the baby so the others can see
who logged what. Nothing else about your Google account is stored.

## How it's built

| Part | What it uses |
| --- | --- |
| App | One page of plain HTML, CSS and JavaScript (`public/`), no build step |
| Sign-in | Firebase Authentication with Google |
| Data | Cloud Firestore, live updates and an offline cache |
| Hosting | Firebase Hosting |

```
public/
  index.html             page and styles
  app.js                 all app logic
  manifest.webmanifest   home-screen install details
  icon-*.png             app icons
firestore.rules          who can read and write what
firebase.json            hosting and rules deployment
```

### Data model

```
babies/{babyId}
  name, born, createdBy, createdAt
  members:    [uid, ...]                 people who can see this baby
  invites:    [email, ...]               pending invitations (lower case)
  memberInfo: { uid: { name, photo } }   shown next to log entries

babies/{babyId}/logs/{logId}
  kind:     "sleep" | "feed"
  start, end              milliseconds; end is null while a timer runs
  feedType: "breast" | "bottle" | "solids"
  amountMl                bottle feeds only
  note, by (uid), updatedAt
```

## Setting it up

Everything runs on Firebase's free Spark plan, which is far more than two parents
need. It takes about 15 minutes, once.

### 1. Create a Firebase project

1. Go to <https://console.firebase.google.com>, click **Create a project** and note
   its **project ID**, for example `baby-days-4f2a1`. Google Analytics can be off.
2. **Build → Authentication → Get started → Google**: switch it on, choose a support
   email and save.
3. **Build → Firestore Database → Create database**: pick a European location (for
   example `europe-west4`, Netherlands) and start in production mode.
4. **Project settings → Your apps → `</>`**: register a web app called `Baby Days`
   and tick **Also set up Firebase Hosting**.

### 2. Deploy

With [Node.js](https://nodejs.org) installed, run this in the repository folder:

```bash
npx firebase-tools login
npx firebase-tools deploy --project YOUR-PROJECT-ID
```

This publishes the app and the security rules. The app reads its Firebase settings
from Firebase Hosting automatically, so there's no config file to edit.

### 3. Install on your phones

1. In Safari, open `https://YOUR-PROJECT-ID.firebaseapp.com`. Use the
   `.firebaseapp.com` address rather than `.web.app`, because Google sign-in on
   iPhone is more reliable there.
2. Tap **Share → Add to Home Screen**, open the app from the home screen and sign in.
   The home-screen app keeps its own sign-in, separate from Safari.
3. Add your baby, open **Sharing**, and invite your partner's Google email address.
   Send them the same link; they sign in and tap **Join**.

## Making changes

Edit the files in `public/` and run the deploy command again. Phones load the new
version the next time the app is opened.
