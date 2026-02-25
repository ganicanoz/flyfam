# FlyFam Mobile App

React Native + Expo app for FlyFam (iOS & Android).

## Prerequisites

- **Node.js** (v18 or newer) — [nodejs.org](https://nodejs.org)
- **npm** — comes with Node.js
- **iOS**: Xcode (Mac only) and an iOS simulator, or a physical iPhone
- **Android**: Android Studio with an emulator, or a physical Android device

---

## Step-by-Step Setup

### Step 1: Open the mobile folder

From your terminal, go to the project folder and into the `mobile` directory:

```bash
cd /Users/mineoz/Desktop/FlyFam/mobile
```

### Step 2: Install dependencies

This installs the libraries the app needs (React Native, Expo, Supabase, etc.):

```bash
npm install
```

Wait for it to finish; it creates a `node_modules` folder.

### Step 3: Set up environment variables

Create a `.env` file in the `mobile` folder. You can copy from the project root:

```bash
cp ../.env.example .env
```

Then edit `mobile/.env` and make sure these are set:

```
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

- Open your Supabase project at [supabase.com](https://supabase.com)
- Go to **Settings → API**
- Use **Project URL** for `EXPO_PUBLIC_SUPABASE_URL`
- Use the **anon public** key for `EXPO_PUBLIC_SUPABASE_ANON_KEY`

### Step 4: Confirm Supabase is ready

Ensure:

1. All migrations have been run (tables exist)
2. The `create_profile` RPC exists
3. Email auth is set up and, for development, email confirmation can be turned off in **Auth → Providers → Email**

### Step 5: Start the app

```bash
npx expo start
```

A dev server starts. In the terminal you’ll see options like:

- Press **`i`** — open iOS simulator
- Press **`a`** — open Android emulator
- Or scan the QR code with **Expo Go** on your phone (both devices must be on the same network)

### Step 6: Run on a device or simulator

- **iOS Simulator**: Press `i` (requires Xcode on Mac)
- **Android Emulator**: Press `a` (requires an Android emulator running)
- **Physical device**: Install **Expo Go** from the App Store/Play Store and scan the QR code

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `command not found: npm` | Install Node.js from [nodejs.org](https://nodejs.org) |
| Supabase connection errors | Check `.env` values and that your Supabase project is running |
| "Invalid API key" | Use the **anon** key, not the service role key, in the app |
| Sign-up doesn't work | Turn off email confirmation in Supabase Auth for development |
| iOS simulator not opening | Install Xcode from the App Store and run it once |
| Android emulator not opening | Create a device in Android Studio’s Device Manager |

---

## Project structure

```
App.tsx              # Root with React Navigation
index.js             # Entry point
screens/             # All screens (Welcome, SignIn, SignUp, etc.)
contexts/
└── SessionContext.tsx
lib/
└── supabase.ts
```

## Features

- **Auth**: Sign up, sign in, role selection (crew/family)
- **Crew**: Complete profile with company, add flights manually, manage family connections, generate invite codes
- **Family**: Connect via invite code, view crew roster
