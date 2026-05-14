# Memory

## Project Overview

This project is a production-oriented Web3 application built around the SUI ecosystem, using Walrus and Seal as core infrastructure primitives.

The current phase is:
- Local-first development
- Testnet integration
- Rapid iteration on UX/UI
- Strong architectural foundations for future production deployment

The long-term goal is:
- Production-grade deployment on VPS/cloud infrastructure
- Mainnet-ready architecture
- Secure and scalable backend/API design
- Reliable encryption and decentralized storage flows
- Exceptional user experience with minimal friction

The application should always be treated as a real production system, not a prototype toy project.

---

# Core Product Philosophy

## Product Priorities

Priority order:

1. UX/UI quality
2. Reliability
3. Real infrastructure integration
4. Maintainable architecture
5. Performance optimization
6. Developer convenience

The application experience should feel:
- Fast
- Modern
- Minimal
- Trustworthy
- Smooth
- Human-centered

Every feature should reduce friction and cognitive load.

---

# Engineering Principles

## Production Mindset

Always assume:
- The app will eventually handle real users
- The app will be deployed publicly
- APIs will be exposed to the internet
- Wallet interactions involve real assets
- Encryption/storage flows must be reliable
- Failures must be handled gracefully

Avoid:
- Temporary hacks unless explicitly marked
- Fake implementations pretending to be production
- Hardcoded secrets
- Client-side trust assumptions
- Fragile architecture
- Overengineering early

Prefer:
- Clean abstractions
- Scalable folder structures
- Reusable components
- Strong typing
- Explicit error handling
- Predictable data flow

---

# Infrastructure Direction

## Blockchain Stack

Core technologies:
- SUI
- Walrus
- Seal

Rules:
- Prefer real integrations over mocks whenever feasible
- Use testnet during development
- Build architecture compatible with future mainnet migration
- Avoid writing logic tightly coupled to testnet-only assumptions

Future-ready design is important.

---

# Deployment Philosophy

## Current State

Current workflow:
- Local development
- Fast iteration
- Testing integrations
- UI/UX refinement

## Future State

Target deployment:
- VPS or cloud-hosted infrastructure
- Production API services
- Background jobs/workers if necessary
- Proper environment variable management
- Secure secret handling
- Reverse proxy architecture
- HTTPS
- Logging + monitoring
- Scalable backend structure

When designing APIs or backend logic:
- Think about deployment implications
- Think about scalability
- Think about rate limiting
- Think about server resource usage
- Think about observability
- Think about security

---

# API Development Guidelines

## API Design

All API routes should:
- Validate inputs
- Return typed responses
- Handle failures gracefully
- Avoid leaking sensitive information
- Use proper HTTP status codes
- Be production-safe

Prefer:
- Centralized error handling
- Shared validation utilities
- Consistent response structures
- Server-side verification where applicable

Avoid:
- Silent failures
- Unsafe trust assumptions
- Excessive client authority
- Business logic duplication

---

# Security Standards

Security is important from the beginning.

Always consider:
- Wallet safety
- Secret management
- API abuse
- Injection risks
- File upload validation
- Encryption integrity
- Authentication boundaries

Never:
- Commit secrets
- Expose private keys
- Store sensitive credentials insecurely
- Trust unvalidated client data

Use:
- Environment variables
- Validation schemas
- Secure defaults
- Principle of least privilege

---

# UI/UX Standards

UI/UX quality is a core product feature.

The interface should feel:
- Premium
- Responsive
- Intentional
- Clean
- Consistent

Focus on:
- Visual hierarchy
- Spacing consistency
- Typography balance
- Smooth transitions
- Clear feedback states
- Accessibility
- Mobile responsiveness
- Wallet interaction clarity

Every screen should answer:
- What is happening?
- What should the user do next?
- What state is the system in?

Avoid:
- Clutter
- Excessive modal usage
- Confusing navigation
- Inconsistent spacing
- Random colors
- Poor loading states

---

# Frontend Architecture

Prefer:
- Reusable UI components
- Modular architecture
- Clear separation of concerns
- Shared design patterns
- Predictable state management

Keep:
- Components composable
- Business logic separated from presentation
- API logic centralized when possible

Avoid:
- Massive components
- Deep prop drilling
- Duplicate UI logic
- Inconsistent styling approaches

---

# Backend Architecture

Backend systems should be:
- Modular
- Observable
- Replaceable
- Scalable

Structure logic so future migration is easier:
- Local → VPS
- Single server → distributed architecture
- Testnet → mainnet

Prefer:
- Service layers
- Shared utilities
- Queue-ready architecture where needed
- Separation between blockchain logic and API layer

---

# Error Handling

Errors should:
- Be visible
- Be actionable
- Help debugging
- Not confuse users

Always:
- Handle loading states
- Handle empty states
- Handle failed requests
- Handle wallet rejection flows
- Handle chain/network mismatch scenarios

Avoid:
- Infinite loading
- Silent crashes
- Generic unknown errors
- Broken UI states

---

# Logging & Debugging

Code should be easy to debug.

Prefer:
- Structured logs
- Meaningful error messages
- Traceable API flows
- Explicit async handling

Avoid:
- Random console spam
- Swallowed exceptions
- Unclear state transitions

---

# Performance Standards

Optimize for:
- Perceived performance
- Smooth interactions
- Fast initial load
- Minimal unnecessary rerenders

Avoid premature micro-optimization.

First prioritize:
- Correctness
- UX quality
- Reliability
- Maintainability

---

# Code Style Guidelines

## General Rules

- Use descriptive variable and function names
- Prefer readability over cleverness
- Keep functions focused
- Extract reusable logic
- Follow existing project patterns
- Use strict typing where possible

## File Organization

Prefer:
- Feature-based structure
- Logical grouping
- Clear naming conventions

Avoid:
- Random utility dumping
- Giant files
- Mixed responsibilities

---

# Development Workflow

## Workflow Philosophy

1. Build locally
2. Validate functionality
3. Test real integrations
4. Refine UX/UI
5. Harden architecture
6. Prepare deployment path
7. Move toward production

## Before Implementing Features

Think through:
- User flow
- Failure cases
- API implications
- Future scalability
- Security implications
- Mobile experience
- Mainnet compatibility

---

# Decision-Making Framework

When making implementation decisions, prioritize:

1. User experience
2. Reliability
3. Long-term maintainability
4. Production readiness
5. Simplicity
6. Performance

Do not optimize for short-term speed if it creates long-term instability.

---

# Common Workflows

## Adding New Features

Before coding:
- Understand user flow
- Understand backend implications
- Identify edge cases
- Consider deployment impact

After coding:
- Verify responsive behavior
- Verify loading/error states
- Verify wallet interactions
- Verify API safety
- Verify typing consistency

---

## Blockchain Integration Workflow

Preferred flow:
1. Testnet integration
2. Real transaction flow
3. Error handling
4. UX refinement
5. Performance improvements
6. Mainnet preparation

Avoid fake blockchain simulations unless explicitly required for isolated UI testing.

---

## API Workflow

For every new API route:
- Validate inputs
- Add typed responses
- Handle failures
- Consider rate limiting
- Think about deployment environment
- Think about scalability

---

# Important Architectural Notes

The application should gradually evolve into:
- Production-ready infrastructure
- Mainnet-compatible architecture
- Secure decentralized application stack
- Clean and scalable frontend/backend system

Every implementation decision should move the project closer to that goal.
