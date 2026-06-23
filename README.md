# Leadership Assessment Backend

Node.js + Express + MongoDB backend for authentication and role-based access.

## Implemented Scope (up to Login)

- MongoDB connection with Mongoose
- User collection/schema
- Default user seeding (admin + respondent)
- JWT login
- Auth middleware
- Role middleware
- Protected auth test routes

## Project Structure

- config/db.js: Mongo connection
- controllers/authController.js: register, login, me, logout
- middleware/authMiddleware.js: validates JWT
- middleware/roleMiddleware.js: role guards
- models/users.js: User schema and model
- routes/authRoute.js: auth and role-protected routes
- utils/seedUsers.js: seeds default users on startup
- server.js: app bootstrap

## Setup

1. Install dependencies:
   npm install

2. Configure environment:
   Copy .env.example to .env and update values.

3. Start API:
   npm run dev

## API Endpoints

- POST /api/auth/register
- POST /api/auth/login
- POST /api/auth/logout (protected)
- GET /api/auth/me (protected)
- GET /api/auth/admin-only (protected ADMIN)
- GET /api/auth/respondent-only (protected RESPONDENT or ADMIN)

## Login Request Example

POST /api/auth/login

{
  "email": "admin@leadership.com",
  "password": "admin123"
}

Successful response format:

{
  "success": true,
  "data": {
    "token": "...",
    "user": {
      "id": "...",
      "name": "System Admin",
      "email": "admin@leadership.com",
      "role": "ADMIN"
    },
    "expiresAt": 1760000000000
  }
}

## Frontend Connection Notes

- Set frontend env: VITE_API_BASE_URL=http://localhost:5000
- Send token in header for protected APIs:
  Authorization: Bearer <token>
