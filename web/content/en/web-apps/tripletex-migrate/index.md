---
title: "Switch from Tripletex to ReAI"
seoTitle: "Switch from Tripletex to ReAI: customers and suppliers from SAF-T"
description: "Upload the SAF-T file from Tripletex and move customers and suppliers into ReAI with their customer numbers, supplier numbers and organization numbers."
summary: "Move customers and suppliers from Tripletex to ReAI with the SAF-T file."
industry: operations
webAppUrl: /app/tripletex-migrate/
sourcePath: web/worker/apps/tripletex-migrate.js
highlights:
  - "Reads customers and suppliers from SAF-T Financial, the standard format from the Norwegian Tax Administration"
  - "Keeps customer numbers, supplier numbers, organization numbers and email addresses"
  - "Skips contacts that already exist in ReAI with the same organization number"
---

## What moves into ReAI

The integration reads the customer and supplier register in the SAF-T file and lists every contact before anything is sent to ReAI. You import each contact with one click. When the organization number already exists in ReAI, no new contact is created.

| From SAF-T | In ReAI |
| --- | --- |
| Customer with customer number | Customer with the same number |
| Supplier with supplier number | Supplier with the same number |
| Organization number and email | Organization number and email on the contact |

Book the opening balance from the same file in the [SAF-T tool](/app/saft/). Products are not part of the SAF-T file, so add them in ReAI or import them from a product list.

## Setup

1. Export the SAF-T file (SAF-T Financial) for the latest financial year from Tripletex. Search for SAF-T in the Tripletex help centre if you cannot find the export. Unzip it if you get a ZIP file.
2. Click **Open integration**, connect ReAI and choose the company.
3. Upload the XML file and check the list of customers and suppliers.
4. Click **Import to ReAI** on the contacts you want to move.

The file is read only for that request and is never stored.
