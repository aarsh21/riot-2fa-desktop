# Riot 2FA

<!-- impeccable:product-schema 1 -->

## Platform

adaptive

## Stack

GPUIx with React and TypeScript for the native desktop interface. Account logic runs in TypeScript inside the same compiled Bun application. No separate service or localhost server. Target Windows, Linux, and macOS.

## Users

People managing two-factor authentication for their own Riot accounts on desktop.

## Product Purpose

View and copy account codes, add accounts through browser login or a secret, and explicitly approve or deny sign-in requests.

## Capabilities and Constraints

Preserve SHA-256 TOTP with six digits and a 30-second period, manual account addition, browser login, push approvals, QR sign-in, and local account storage. Never automatically approve a sign-in. No real account data in screenshots or fixtures.

## Brand Commitments

User requested Vercel-inspired monochrome styling, Geist typography, restrained controls, clear hierarchy, light and dark system themes, and no decorative effects. Product identity remains Riot 2FA; this is not an official Vercel or Riot product.

## Evidence on Hand

Native source under desktop/src, synthetic UI checks, and user-confirmed Linux sign-in. Cross-platform execution must be reported separately from source compatibility.
