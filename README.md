# BloodLink - Full-Stack Blood Donation Management Platform

**BloodLink** is a student-level web platform that directly connects blood donors with individuals and hospitals requiring blood in real time.

---

## 📌 Problem Statement
In emergency medical situations, finding compatible blood donors locally and quickly is a major challenge. Traditional approaches often rely on manual phone calls, social media broadcasts, or fragmented communications, resulting in crucial delays. BloodLink solves this by providing a unified, location-aware matching and notification platform.

---

## 🎯 Objectives
- **Local Connection**: Connect blood seekers & hospitals directly with nearby available blood donors based on city, area, and blood group compatibility.
- **Role-Based Access**: Provide tailored interfaces for Donors, Blood Seekers, Hospitals, and System Administrators.
- **Real-Time Notification System**: Notify compatible donors automatically whenever an emergency request is created in their location.
- **End-to-End Tracking**: Track the status of blood requests from pending to acceptance and fulfillment.

---

## 💻 Technology Stack

### Frontend
- **HTML5**: Semantic web structure
- **CSS3**: Vanilla CSS with CSS variables, Flexbox, Grid, and mobile media queries
- **Vanilla JavaScript**: Pure JS with `fetch()` API for backend communication

### Backend
- **Node.js & Express.js**: REST API server and static web host
- **Authentication**: JSON Web Tokens (JWT) & `bcryptjs` password hashing

### Database
- **SQLite (`sqlite3`)**: Lightweight relational database created automatically upon backend server launch

---

## 📂 Required Folder Structure

```
BloodLink/
│
├── backend/
│   ├── server.js
│   ├── package.json
│   ├── database/
│   │   ├── bloodlink.db
│   │   └── db.js
│   │
│   ├── routes/
│   │   ├── authRoutes.js
│   │   ├── donorRoutes.js
│   │   ├── requestRoutes.js
│   │   ├── hospitalRoutes.js
│   │   ├── notificationRoutes.js
│   │   └── adminRoutes.js
│   │
│   ├── controllers/
│   │   ├── authController.js
│   │   ├── donorController.js
│   │   ├── requestController.js
│   │   └── adminController.js
│   │
│   ├── middleware/
│   │   └── authMiddleware.js
│   │
│   └── utils/
│       └── matching.js
│
├── frontend/
│   ├── index.html
│   ├── login.html
│   ├── register.html
│   ├── forgot-password.html
│   │
│   ├── donor/
│   │   ├── dashboard.html
│   │   ├── profile.html
│   │   ├── search.html
│   │   ├── requests.html
│   │   ├── history.html
│   │   └── notifications.html
│   │
│   ├── hospital/
│   │   ├── dashboard.html
│   │   ├── create-request.html
│   │   ├── requests.html
│   │   └── donors.html
│   │
│   ├── admin/
│   │   ├── dashboard.html
│   │   ├── users.html
│   │   ├── donors.html
│   │   ├── hospitals.html
│   │   └── requests.html
│   │
│   ├── css/
│   │   ├── style.css
│   │   ├── auth.css
│   │   ├── dashboard.css
│   │   └── responsive.css
│   │
│   └── js/
│       ├── api.js
│       ├── auth.js
│       ├── donor.js
│       ├── hospital.js
│       ├── admin.js
│       ├── requests.js
│       └── notifications.js
│
└── README.md
```

---

## 🗄️ Database Tables (SQLite)

1. **`users`**: Stores user authentication data, role, contact, location (`city`, `area`), and account status (`Active`/`Disabled`).
2. **`donors`**: Linked to `users`. Stores blood group, availability (`Available`/`Not Available`), and last donation date.
3. **`blood_requests`**: Stores hospital name, blood group required, units, location, urgency (`Normal`, `Urgent`, `Emergency`), and status (`Active`, `Fulfilled`, `Cancelled`).
4. **`donation_requests`**: Links blood requests with targeted donors and tracks status (`Pending`, `Accepted`, `Declined`).
5. **`notifications`**: Stores in-app alerts sent to users regarding request matches and status updates.

---

## 🔄 Core Workflow

```
User Registration (Donor / Seeker / Hospital)
       ↓
Login (JWT Token Authentication)
       ↓
Donor completes Donor Profile (Blood Group, Availability)
       ↓
Seeker / Hospital creates Emergency Blood Request
       ↓
Matching Utility searches compatible local donors
       ↓
In-App Notification automatically sent to matching donors
       ↓
Donor Accept / Decline Request
       ↓
Requester receives notification with Donor contact info
       ↓
Hospital/Requester marks Request as Fulfilled
       ↓
Real-Time Database Statistics Update
```

---

## 🔑 Demo Accounts (Pre-seeded on Server Startup)

The system automatically initializes and seeds demo data on its first run:

| Role | Email | Password | Details |
| :--- | :--- | :--- | :--- |
| **Donor** | `rahul@gmail.com` | `123456` | O+ Donor, Mumbai (Andheri) |
| **Donor** | `priya@gmail.com` | `123456` | A+ Donor, Mumbai (Bandra) |
| **Donor** | `aman@gmail.com` | `123456` | B+ Donor, Thane (Naupada) |
| **Hospital** | `hospital@citycare.com` | `123456` | CityCare Hospital Account |
| **Seeker** | `seeker@gmail.com` | `123456` | Blood Seeker Account |
| **Admin** | `admin@bloodlink.com` | `admin123` | Platform Administrator |

---

## 🛠️ How to Run the Project

1. Navigate to the `backend` folder:
   ```bash
   cd backend
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the Express server:
   ```bash
   npm start
   ```

4. Open your browser and navigate to:
   ```
   http://localhost:3000
   ```

---

## 🚀 Future Scope
- Integration with SMS gateways for urgent SMS notifications.
- Geographic map visualization of nearby donors.
- Integration with hospital blood bank inventory management systems.
