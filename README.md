# Campus Market

A full-stack peer-to-peer student marketplace. Buy and sell textbooks, electronics, furniture, and more with verified students on your campus.

## Tech Stack

- **Backend**: Node.js + Express + NeDB (embedded, zero-config database)
- **Frontend**: Vanilla HTML/CSS/JS — no build step required
- **Auth**: JWT + bcrypt
- **Icons**: Lucide (inline SVG, no dependency)
- **Fonts**: Instrument Serif + Geist (Google Fonts)

## Quick Start

```bash
# 1. Install dependencies
cd backend
npm install

# 2. Start the server
node server.js

# 3. Open in browser
# http://localhost:3001
```

The server serves the frontend automatically — no separate frontend server needed.

## Demo Account

```
Email:    demo@university.edu
Password: password123
```

Seed accounts (all use `password123`):
- `sarah@berkeley.edu` — UC Berkeley
- `alex@stanford.edu`  — Stanford
- `priya@ucla.edu`     — UCLA

## Pages

| Page                 | URL                                   |
|----------------------|---------------------------------------|
| Landing              | `/`                                   |
| Marketplace          | `/pages/marketplace.html`             |
| Listing detail       | `/pages/listing.html?id=<id>`         |
| Create listing       | `/pages/sell.html`                    |
| Edit listing         | `/pages/sell.html?edit=<id>`          |
| Buyer dashboard      | `/pages/buyer-dashboard.html`         |
| Seller dashboard     | `/pages/seller-dashboard.html`        |
| Messages             | `/pages/messages.html`                |
| Auth                 | `/pages/auth.html`                    |

## Project Structure

```
campusmarket/
├── backend/
│   ├── db/
│   │   └── database.js       # NeDB schema + demo seed data
│   ├── middleware/
│   │   └── auth.js           # JWT middleware
│   ├── routes/
│   │   ├── auth.js           # Register, login, profile
│   │   ├── listings.js       # CRUD, search, save/unsave
│   │   ├── messages.js       # Conversations + messaging
│   │   └── orders.js         # Orders, stats, saved items
│   ├── .env                  # Port + JWT secret
│   ├── package.json
│   └── server.js             # Express entry point
└── frontend/
    ├── css/main.css          # Full design system (tokens, components)
    ├── js/app.js             # API client, auth, icons, helpers
    ├── pages/
    │   ├── auth.html
    │   ├── marketplace.html
    │   ├── listing.html
    │   ├── sell.html
    │   ├── buyer-dashboard.html
    │   ├── seller-dashboard.html
    │   └── messages.html
    └── index.html            # Landing page
```

## API Endpoints

### Auth
| Method | Endpoint           | Auth | Description             |
|--------|--------------------|------|-------------------------|
| POST   | `/api/auth/register` | —  | Register (.edu required)|
| POST   | `/api/auth/login`    | —  | Login, returns JWT      |
| GET    | `/api/auth/me`       | ✓  | Current user profile    |
| PUT    | `/api/auth/profile`  | ✓  | Update profile          |

### Listings
| Method | Endpoint                   | Auth     | Description            |
|--------|----------------------------|----------|------------------------|
| GET    | `/api/listings`            | optional | Search + filter        |
| GET    | `/api/listings/:id`        | optional | Listing detail         |
| POST   | `/api/listings`            | ✓        | Create listing         |
| PUT    | `/api/listings/:id`        | ✓        | Update listing         |
| DELETE | `/api/listings/:id`        | ✓        | Delete listing         |
| POST   | `/api/listings/:id/save`   | ✓        | Toggle save            |
| GET    | `/api/listings/user/:uid`  | —        | User's listings        |

**Search params:** `q`, `category`, `campus`, `condition`, `min_price`, `max_price`, `sort` (newest/oldest/price_asc/price_desc/popular), `page`, `limit`

### Messages
| Method | Endpoint                         | Auth | Description         |
|--------|----------------------------------|------|---------------------|
| GET    | `/api/messages/conversations`    | ✓   | All conversations   |
| GET    | `/api/messages/conversations/:id`| ✓   | Thread + mark read  |
| POST   | `/api/messages/send`             | ✓   | Send message        |

### Orders
| Method | Endpoint               | Auth | Description          |
|--------|------------------------|------|----------------------|
| GET    | `/api/orders/buying`   | ✓   | My purchases         |
| GET    | `/api/orders/selling`  | ✓   | Incoming orders      |
| GET    | `/api/orders/saved`    | ✓   | Saved listings       |
| GET    | `/api/orders/stats`    | ✓   | Seller stats         |
| POST   | `/api/orders`          | ✓   | Create order         |
| PUT    | `/api/orders/:id/status`| ✓  | Update order status  |

## Environment Variables (`backend/.env`)

```
PORT=3001
JWT_SECRET=change_this_in_production
NODE_ENV=development
```

## Features

- **.edu verification** — only university emails can register
- **Listings** — create, edit, delete, search, filter, sort, paginate
- **Save / Wishlist** — bookmark listings
- **Messaging** — threaded conversations with real-time polling (4s)
- **Orders** — buyer requests → seller confirms/declines → mark complete
- **Seller Dashboard** — stats, listing management, order management, analytics
- **Buyer Dashboard** — purchase history, saved items, profile settings
- **Responsive** — mobile + desktop layouts throughout

## Production Notes

- Change `JWT_SECRET` to a secure random string
- Add rate limiting (`express-rate-limit`)
- Add image upload (Cloudinary / S3) — currently images are URL-based
- NeDB stores data in `backend/db/data/` — back this up
- For scale, replace NeDB with PostgreSQL or MongoDB
