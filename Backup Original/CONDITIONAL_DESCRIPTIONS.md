# Conditional Description Patterns for All Tools

## Philosophy: "When to Use" > "What it Does"

AI models make better tool selection decisions when descriptions focus on **triggers** and **context** rather than just functionality.

---

## Pattern Templates

### Pattern 1: Navigation Tools
```
[Tool Name] - [Primary Action]

USE THIS WHEN:
- User says "[trigger phrase 1]"
- User says "[trigger phrase 2]"
- [Contextual condition]

WORKFLOW:
1️⃣ [This tool] → 2️⃣ [Next logical step] → 3️⃣ [Then action]

❌ DO NOT USE when [anti-pattern]
✅ USE when [correct pattern]
```

### Pattern 2: Interaction Tools
```
[Tool Name] - [Primary Action]

⚠️ PREREQUISITE: [Required step before this tool]

USE THIS WHEN:
- [User intent 1]
- [User intent 2]

PROPER WORKFLOW:
1️⃣ [Analysis step] → 2️⃣ [This tool] → 3️⃣ [Verification]

COMMON MISTAKE: [What AI typically gets wrong]
```

### Pattern 3: Analysis/Inspection Tools
```
[Tool Name] - [Primary Action]

🔍 USE THIS WHEN:
- [Symptom 1] (e.g., "content missing after click")
- [Symptom 2] (e.g., "page loads but data empty")
- [Symptom 3]

WHY CRITICAL: [Explains the "why" - what's invisible without this tool]

WHEN NOT TO USE: [Situations where simpler tool suffices]
```

### Pattern 4: Network/Debugging Tools
```
[Tool Name] - [Primary Action]

🚨 USE THIS WHEN:
- After [action], expected [result] doesn't appear
- Suspecting [technical condition]
- Need to [specific diagnostic]

WORKFLOW STEP: [X] of [Y]
PREVIOUS: [What should have been done before]
NEXT: [What to do after]

TROUBLESHOOTING: If [problem], this tool reveals [hidden information]
```

### Pattern 5: Configuration/Setup Tools
```
[Tool Name] - [Primary Action]

⚙️ CONFIGURE BEFORE: [Type of operation]

PARAMETERS AI SHOULD SET:
- [param1]: [guidance on value selection]
- [param2]: [guidance on value selection]

TYPICAL VALUES:
- Simple operations: [value]
- Complex operations: [value]
- Heavy operations: [value]
```

---

## Application Strategy

### Phase 1: Critical Path Tools (HIGH PRIORITY)
Tools that are most commonly used and most likely to be misused:
- ✅ navigate (DONE)
- ✅ create_tab (DONE)
- ✅ click (DONE)
- ✅ type (DONE)
- ✅ get_html (DONE)
- ✅ screenshot (DONE)
- ✅ execute_script (DONE)
- ✅ enable_response_interception (DONE)
- ✅ list_intercepted_responses (DONE)

### Phase 2: Analysis & Debugging (MEDIUM PRIORITY)
- get_text
- get_attribute
- wait_for_selector
- list_tabs
- get_url
- get_cookies
- list_all_targets
- connect_to_target
- execute_in_target

### Phase 3: Advanced Network (MEDIUM PRIORITY)
- modify_intercepted_response (partially done)
- create_mock_endpoint
- enable_websocket_interception
- start_har_recording
- export_har_file
- inject_css_global
- inject_js_global

### Phase 4: Specialized Tools (LOWER PRIORITY)
- Anti-detection tools
- Service worker tools
- Session management
- Print to PDF
- Storage tools

---

## Key Principles

1. **Start with "WHEN"**: What triggers using this tool?
2. **Explain "WHY"**: What's invisible/unclear without it?
3. **Show "HOW"**: What's the workflow?
4. **Warn against anti-patterns**: What mistakes do AIs make?
5. **Guide parameters**: What values should AI choose?

---

## Examples Applied

### Before (generic):
```typescript
name: 'get_cookies',
description: 'Get all cookies for the current domain'
```

### After (conditional):
```typescript
name: 'get_cookies',
description: `🔍 Retrieves browser cookies for current domain.

USE THIS WHEN:
- Debugging authentication issues (checking if auth token exists)
- Session not persisting (verify session cookies)
- Login appears successful but features unavailable (check cookie values)
- Need to verify third-party cookies loaded

WHY: Cookies often contain hidden auth/session data not visible in HTML.
Many login/auth issues are cookie-related (expired, wrong domain, httpOnly).

COMMON ISSUES DIAGNOSED:
- "User logged in but still see login page" → Check auth cookie
- "Cart items disappear" → Check session cookie
- "Preferences not saving" → Check settings cookie`
```

---

This pattern should be applied to ALL 84+ tools systematically.
