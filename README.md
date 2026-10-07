# Zoom Clone

A full-stack video meeting application with a Zoom-inspired interface. The project combines a Next.js frontend with a FastAPI backend to support instant meetings, scheduled meetings, video calls, screen sharing, participant management, and real-time chat.

This is an independent demonstration project and is not affiliated with Zoom.

## Features

### Accounts and dashboard

- Email and password registration and sign-in.
- Automatic sign-in with a built-in Default account for first-time visitors.
- Account menu with Available, Away, and Busy status options, plus sign-out.
- Dashboard with a clock, calendar navigation, scheduled meetings, and recent meetings.
- Instant meeting creation with the title `<User Name>'s Zoom Meeting`.
- Scheduling form with a topic, description, date, time, duration, and timezone.
- Meeting ID and invitation link entry, guest joining, and an invalid-link screen.
- Optional sign-in during the invitation flow with a return to the meeting afterward.
- Back to Meeting button while a meeting remains active.
- Recordings, meeting metadata summaries, and private browser-local notes.
- Activity Center with Focus and Other tabs.

### Meeting experience

- Camera and microphone controls with WebRTC audio and video.
- Screen sharing alongside an independent camera feed.
- Shared content on the left and participant videos on the right, with a resizable divider.
- Screen-share video pages containing up to six participants, with navigation arrows.
- Scrollable gallery for larger meetings.
- Participant and chat panels stacked in the order they are opened.
- Real-time chat with sender details, timestamps, grouped messages, and unread counts.
- Incoming-message previews when the chat panel is closed.
- Emoji reactions on participant videos, raised hands, and persistent feedback indicators.
- Host controls for muting participants, removing participants, and ending the meeting for everyone.
- Separate Leave Meeting and End Meeting for All actions for the host.
- Meeting information menu with the meeting ID and invitation link copying.
- Mutually exclusive toolbar menus that close on an outside click or Escape.
- Automatic session transfer when the same account joins the same meeting in another window.
- Post-meeting quality feedback.

## Technology

| Layer | Technology |
| --- | --- |
| Frontend | Next.js 15, React 19, TypeScript |
| Icons | Lucide React |
| Backend | FastAPI, Uvicorn, Pydantic |
| Database | SQLite with SQLAlchemy |
| Real-time events | WebSockets |
| Audio, video, and screen sharing | WebRTC |

## Project structure

```text
zoom-clone/
├── frontend/
│   ├── src/app/          # Dashboard, authentication, joining, scheduling, and meetings
│   ├── src/components/   # Shared UI and default-account initialization
│   ├── src/lib/          # API utilities
│   ├── .env.example
│   └── package.json
├── backend/
│   ├── app/main.py       # API, models, WebSockets, and meeting state
│   ├── app/seed.py       # Optional demo data
│   ├── .env.example
│   └── requirements.txt
└── README.md
```

## Local setup

Install Node.js 20 or later and Python 3.10 or later. Run the backend and frontend in separate terminals.

### Backend

From the project root:

```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload
```

The API runs at `http://localhost:8000`. Interactive API documentation is available at `http://localhost:8000/docs`, and the health endpoint is `/api/health`.

The backend creates its database and the Default account automatically.

### Frontend

From the project root:

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:3000`.

For a local production build:

```bash
npm run build
npm start
```

### Default account

| Field | Value |
| --- | --- |
| Name | Default |
| Email | default@user.com |
| Password | default123 |

Fresh browsers start signed in as Default. Users can sign out and create or sign into another account. An existing signed-in account is retained, and an explicit sign-out persists across reloads.

Use separate accounts when testing simultaneous participants. Sharing the Default account across windows exercises the account's active-meeting session-transfer behavior.

## Environment variables

### Frontend

Configure these in `frontend/.env.local` or the frontend hosting environment:

| Variable | Local value | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | `http://localhost:8000` | Backend HTTP URL |
| `NEXT_PUBLIC_WS_URL` | `ws://localhost:8000` | Backend WebSocket URL |

These values are included in the frontend build. Rebuild the frontend after changing them.

### Backend

| Variable | Local value | Purpose |
| --- | --- | --- |
| `FRONTEND_URL` | `http://localhost:3000` | Frontend origin |
| `CORS_ORIGINS` | `http://localhost:3000,http://127.0.0.1:3000` | Comma-separated allowed origins |
| `ZOOM_DB_PATH` | `backend/data/zoom_clone.db` by default | SQLite file location |

Set backend variables in the shell or hosting dashboard. The backend `.env.local` is a configuration reference; the normal Uvicorn command does not load a `.env` file automatically.

## How it works

The frontend uses HTTP endpoints for accounts, meeting records, scheduling, and active-meeting lookup. WebSockets carry participant events, chat messages, reactions, host controls, and WebRTC signaling. Browser peers exchange media through WebRTC connections.

Camera and screen-share tracks are handled separately so sharing a screen preserves the participant's camera video. Participant paging changes which tiles are visible while keeping their media connections active.

SQLite stores users and meeting records. Live rooms and active-session ownership are held in backend memory. Notes, presence preferences, and meeting-quality feedback are stored in the browser. Recording downloads use the local camera and microphone; summaries present meeting metadata rather than generated transcripts.

## Deployment

The application can use Vercel for the frontend and a persistent backend service such as Railway.

### Backend service

1. Connect the repository and select `backend` as the service root.
2. Install dependencies from `requirements.txt`.
3. Use this start command:

   ```bash
   uvicorn app.main:app --host 0.0.0.0 --port $PORT --workers 1
   ```

4. Attach a persistent volume at `/data` and set `ZOOM_DB_PATH=/data/zoom_clone.db`.
5. Set `FRONTEND_URL` and `CORS_ORIGINS` to the deployed frontend origin.
6. Enable a public HTTPS domain and use `/api/health` as the health-check path.

Keep one backend worker and one replica because live meeting state is stored in memory. The persistent volume preserves account and meeting records across deployments.

### Vercel frontend

1. Import the repository and select `frontend` as the root directory.
2. Use the Next.js framework preset and the default build settings.
3. Set `NEXT_PUBLIC_API_URL` to the backend HTTPS URL.
4. Set `NEXT_PUBLIC_WS_URL` to the corresponding `wss://` URL.
5. Deploy and configure the backend's allowed origins with the resulting frontend URL.

Use origins without a trailing slash. Hosted camera, microphone, and screen sharing require HTTPS. The backend host must support WebSocket connections.

## Manual verification

- Start both services and confirm that a fresh browser opens as Default.
- Sign out, register another account, and verify sign-in and invitation joining.
- Create an instant meeting and schedule a meeting for a selected date.
- Join from separate accounts and test audio, camera video, and chat.
- Share a screen and verify that camera video remains visible, the divider resizes, and participant pages contain no more than six videos.
- Open chat and participants in both orders, and test reactions and closed-chat message previews.
- Open each meeting menu and confirm that another menu or an outside click closes it.
- Test host controls, leaving, ending for everyone, and post-meeting feedback.
- Open the same meeting with the same account in another window and verify session transfer.

## Scope and limitations

This project is intended for demonstrations and development. API and WebSocket identity rely on client-supplied account identifiers rather than server-verified authentication sessions. The shared Default account and public demo credentials should be replaced before use with private meeting data.

WebRTC uses peer-to-peer mesh connections and a public STUN server. A TURN service is not configured, so some network combinations may prevent media connections. Large meetings require a different media architecture for reliable production-scale operation.

Live meetings do not survive a backend restart. Dashboard notes and feedback are browser-local. The Activity Center contains interface states rather than a connected notification service, and recordings are local media downloads rather than cloud recordings.
