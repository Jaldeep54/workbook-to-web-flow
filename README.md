# Business Suite Hub

Build a Complete Web Application from My Excel Workbook
I have uploaded my Excel workbook.

This workbook is my complete business management system.

It contains:

Shop data
Orders
Deliveries
Payments
Fixed Costs
Variable Costs
Label Orders
Label Stock
Multiple Dashboards
The workbook currently works correctly, but it has become slow because it contains approximately 100 shop sheets and many formulas.

I want to replace the entire Excel workbook with a modern web application.

Your role
Act as a senior full-stack software engineer and system architect.

Do not simply recreate Excel.

Analyze how the workbook works and rebuild it as a proper database-driven application.

Whenever business logic exists in Excel formulas, recreate the same logic in code.

Technology Stack
Build using:

Next.js (latest App Router)
React
TypeScript
Tailwind CSS
shadcn/ui
PostgreSQL
Prisma ORM
The project must deploy without modification on Vercel.

Avoid technologies that do not work well on Vercel.

Development Approach
Do NOT generate everything at once.

Instead:

Step 1
Analyze the workbook completely.

Explain:

every sheet
every table
every dashboard
relationships
business logic
formulas
data flow
Then propose the best database structure.

Wait for my approval.

Step 2
Create the database.

Create:

Prisma schema
migrations
seed data if necessary
Step 3
Create the project structure.

Generate:

reusable components
layouts
navigation
authentication
dashboard shell
Step 4
Implement modules one by one.

For example:

Shops
Orders
Deliveries
Payments
Costs
Label Orders
Label Stock
Finish one completely before moving to the next.

Step 5
Create dashboards.

Recreate every dashboard from Excel.

Improve them where appropriate.

Include:

Month filters
Date filters
Search
Sorting
Export to Excel
Export to PDF
Step 6
Create an Excel Import feature.

The application should import my current workbook into the database.

After importing, Excel should no longer be needed.

Database Design
Do NOT create one table per shop.

Instead create relational tables.

Each shop should have:

unique ID
shop name
design type
Changing a shop name must never break reports.

Performance
The application must be significantly faster than Excel.

Support:

500+ shops
thousands of orders
years of history
Use:

efficient SQL queries
indexes
pagination
server-side filtering
caching where appropriate
Code Quality
Write production-quality code.

Use:

TypeScript
reusable components
clean folder structure
proper validation
error handling
No duplicated code.

Deployment
The final project must include:

package.json
prisma schema
.env.example
README
GitHub-ready repository
The project should deploy directly on Vercel after connecting the GitHub repository.

Very Important
Whenever you need clarification about my workbook, ask me questions instead of making assumptions.

Do not simplify or remove features from my Excel workbook.

Preserve all business logic while improving performance and usability.

I have attached the workbook. Start with Step 1: Analyze the workbook.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/4b41200e-90eb-4f70-9e90-885a3f9d1673).

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
