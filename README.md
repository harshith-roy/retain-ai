# RETAIN.AI

### Automated Empathy and Revenue Recovery at Scale

RETAIN.AI is an AI-powered subscription retention platform designed to help businesses understand why customers cancel subscriptions and take intelligent actions to prevent avoidable churn.

Instead of relying on generic cancellation forms, RETAIN.AI uses AI to analyze customer feedback, generate personalized retention offers, and help merchants manage cancellation requests through a centralized dashboard.

---

## 🚀 Key Features

### 1. AI-Powered Retention

* Understands customer cancellation reasons.
* Generates personalized retention offers.
* Uses Groq-powered LLM inference.
* Helps merchants make data-driven retention decisions.

### 2. Customer Subscription Portal

* Customer-facing subscription management.
* PayPal Sandbox subscription checkout.
* Cancellation reason collection.
* AI-generated retention offers.
* Pause and cancellation workflows.

### 3. Merchant Dashboard

* Business overview and retention metrics.
* Customer and subscription management.
* Retention session tracking.
* Revenue analytics.
* Escalation management.

### 4. AI Agent Studio

* Configure retention agent behavior.
* Analyze business websites.
* Generate context-aware customer offers.

### 5. Merchant Escalation Center

* Routes requests requiring human intervention.
* Supports approval workflows.
* Integrates with Slack for notifications.

### 6. Integrations

* **PayPal:** Subscription checkout and payment processing through Sandbox.
* **Firebase:** Authentication and Firestore data storage.
* **Groq:** AI-powered retention recommendations.
* **Firecrawl:** Website crawling and business context extraction.
* **Slack:** Merchant notifications and escalations.
* **Resend:** Email delivery.
* **Inngest:** Background workflows and event processing.
* **ElevenLabs:** Voice capabilities.
* **PostHog:** Product analytics.

---

## 🛠️ Technology Stack

| Category          | Technology              |
| ----------------- | ----------------------- |
| Frontend          | React, TypeScript       |
| Build Tool        | Vite                    |
| Styling           | Tailwind CSS            |
| Backend           | Server-side API routes  |
| Authentication    | Firebase Authentication |
| Database          | Cloud Firestore         |
| AI                | Groq                    |
| Website Analysis  | Firecrawl               |
| Payments          | PayPal Sandbox          |
| Background Jobs   | Inngest                 |
| Notifications     | Slack                   |
| Email             | Resend                  |
| Voice             | ElevenLabs              |
| Analytics         | PostHog                 |
| Deployment Target | Vercel                  |

---

## 🏗️ Application Modules

The merchant dashboard includes:

* Overview
* AI Agent Studio
* Customers
* Subscriptions
* Retention Sessions
* Escalation Center
* Revenue Analytics
* Integrations
* Settings
* Team Access

The customer portal provides a separate interface for subscription management and retention interactions.

---

## 🔄 How It Works

1. A customer visits the merchant's subscription portal.
2. The customer manages their subscription or initiates cancellation.
3. RETAIN.AI collects the customer's cancellation reason.
4. The AI analyzes the reason and generates a relevant retention offer.
5. The customer can accept or decline the offer.
6. Requests requiring merchant intervention can be escalated.
7. The merchant monitors retention activity and business performance through the dashboard.

---

## ⚙️ Local Development Setup

### Prerequisites

* Node.js
* npm
* Git
* Firebase project
* Required third-party API accounts

### 1. Clone the repository

```bash
git clone <YOUR_REPOSITORY_URL>
cd retain-ai
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

Create a `.env` file in the project root.

Use `.env.example` as the reference for the required variables.

```bash
cp .env.example .env
```

Add the appropriate credentials for the integrations you intend to use.

**Important:** Never commit `.env` files, private API keys, Firebase service-account credentials, or other secrets to GitHub.

### 4. Start the development server

```bash
npm run dev
```

Open the local URL displayed in your terminal.

### 5. Production build

```bash
npm run build
```

---

## 🔐 Security

RETAIN.AI uses Firebase Authentication and Firestore security rules to protect merchant workspaces.

Security considerations include:

* Authenticated access to protected application features.
* Workspace-based access restrictions.
* Role-based authorization.
* Server-side handling of sensitive credentials.
* Protected merchant approval workflows.
* Rate limiting for selected AI and analysis endpoints.
* Inngest request signature verification.

Private API keys and service-account credentials must remain server-side.

---

## 🧪 Testing

The project includes automated tests covering application functionality and security-related behavior.

Previously reported test results include:

* 93 tests passed for the PayPal checkout update.
* Production build completed successfully.
* Firebase security rules were tested separately; some later deployment-readiness checks skipped rules tests because the local Firebase testing tool was unavailable.

Run the available test scripts defined in `package.json`.

---

## ☁️ Deployment

The intended production deployment platform is **Vercel**.

General deployment process:

1. Push the project to GitHub.
2. Import the repository into Vercel.
3. Configure the required environment variables.
4. Deploy the application.
5. Add the deployed domain to Firebase Authentication's authorized domains.
6. Configure the Inngest endpoint.
7. Verify external integrations.
8. Test authentication and subscription workflows.

The application uses PayPal Sandbox during development. Configure the appropriate PayPal environment before accepting real payments.

---

## ⚠️ Current Limitations

* PayPal integration currently uses Sandbox for testing.
* Discount, downgrade, and skip-month actions may require merchant-side implementation or approval.
* Real email delivery requires a properly configured and verified sending domain.
* Third-party integrations require valid credentials and configuration.
* Production deployment and live payment processing require separate validation.

---

## 🔮 Future Improvements

* Advanced churn prediction.
* More personalized AI retention strategies.
* Automated subscription plan modifications.
* Improved revenue recovery analytics.
* Expanded merchant automation.
* Deeper customer behavior insights.
* Additional payment provider integrations.

---

## 🎯 Project Objective

The goal of RETAIN.AI is to transform subscription cancellation from a passive process into an intelligent customer-retention opportunity.

By com
