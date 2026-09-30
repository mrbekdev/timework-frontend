# TimeWork Frontend

Build a modern responsive frontend for an employee attendance SaaS called TimeWork. Frontend only (React + Tailwind), ready to connect to a NestJS + PostgreSQL API later. Do not implement backend logic, use mock data and API-ready structure.

Roles

BigAdmin (system owner, cannot be created in UI) creates Admins.

Admin manages only their assigned Store and creates Employees.

Employee has a simple attendance page.

Features

Store Management: name, address, GPS location (map picker), allowed attendance radius (meters), work start/end time, late penalty, early leave penalty, early arrival bonus, overtime bonus. Each Store has one Admin.

Employee Management: photo (camera or upload), full name, phone, position, salary, work schedule, active status.

Attendance Page (public): open camera with getUserMedia, capture face photo, show “Check In” and “Check Out” buttons, display current location, allow attendance only when inside the store radius, and show clear permission/error states (camera denied, location denied, unsupported browser).

Payroll Dashboard: calculate salary from attendance, apply bonuses and penalties, allow manual bonus additions, record salary payments with amount, date, and note, and show payment history.

Dashboards: BigAdmin sees all stores and admins; Admin sees only their own store, employees, attendance, and payroll.

UI Requirements

Clean minimal design (Apple/Linear style).

Mobile-first and desktop responsive.

Sidebar + top navbar.

Tables, cards, filters, search, and status badges.

Camera preview modal that works on Android Chrome and iPhone Safari.

API-ready components with reusable forms, loading, empty, and error states.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/92f00ef9-9030-4bd4-8b2f-4f04b18eeeee).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
