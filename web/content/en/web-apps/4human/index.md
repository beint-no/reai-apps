---
title: "4human HRM & Accounting"
seoTitle: "4human HRM Employee Integration for ReAI"
description: "Fetch employees from 4human HRM and create them in ReAI Employees with contact details, start date, position percentage and bank account."
summary: "Read current employments from the 4human HRM API and create the employees in ReAI one by one."
industry: operations
icon: icons/4human.svg
webAppUrl: /app/4human/
sourcePath: web/worker/apps/4human.js
highlights:
  - "Uses the 4human HRM REST API with the Client ID and Secret Key from 4human"
  - "Name, email, phone, start date, position percentage, address and bank account"
  - "Checks Norwegian bank accounts with MOD11 and skips employees already in ReAI"
---

## What moves into ReAI

The app reads current employments and the matching user profiles in 4human HRM. Former and vacant positions are skipped. For each employee you choose **Create in ReAI**, which creates the employee and an employment line with start date and position percentage. Email, phone, address, national identity number and a MOD11 verified Norwegian bank account are included when 4human has them.

Creating an employee in ReAI does not create a user, send an invitation, submit an A-melding or run payroll. Check the tax card, salary and employment details in ReAI before the first payroll. Employees that already exist in ReAI with the same email or name are shown but not created again.

## Setup

1. In 4human, create a service user: **Vår organisasjon → Onboard → Inviter bruker**, use a shared mailbox, then **Lagre og send invitasjon** and accept the invitation.
2. Order REST API access from 4human support (support@4humanhrm.no) with the service user and the system owner's approval. 4human agrees price and terms and delivers a **Client ID** and **Secret Key**.
3. Click **Open integration**, connect your ReAI company and enter the Client ID and Secret Key.
4. Check the list and create the employees you want in ReAI.

The Client ID and Secret Key are used for one request and never stored.
