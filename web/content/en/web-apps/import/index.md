---
title: Spreadsheet Import
seoTitle: ReAI Spreadsheet Import — Products, customers and suppliers via CSV
description: Import products, customers and suppliers from CSV or TSV files into ReAI with header auto-matching, Mod11 validation and duplicate checks.
summary: Match CSV columns, validate Norwegian org numbers, skip duplicates and import into ReAI.
industry: operations
status: maintained
webAppUrl: /app/import/
sourcePath: web/worker/apps/import.js
highlights:
  - "Supports Products, Customers and Suppliers with downloadable CSV templates and samples"
  - "English and Norwegian column auto-matching plus Mod11 organization number validation"
  - "Pre-checks existing ReAI records by SKU, number, name or email before creating anything"
  - "Exports a formula-safe CSV result report with created ReAI IDs"
icon: icons/import.avif
---

## One canonical importer

Moved from duplicate Mac and Windows binaries to a single web app on `apps.reai.no/app/import/`. Works on any modern browser with zero installation.
