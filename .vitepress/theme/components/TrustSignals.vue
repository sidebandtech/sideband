<script setup lang="ts">
const signals = [
  {
    icon: "lock",
    title: "E2EE",
    description: "Relay can't see your data",
  },
  {
    icon: "file",
    title: "Open Protocol",
    description: "No vendor lock-in",
  },
  {
    icon: "code",
    title: "TypeScript",
    description: "Full type safety",
  },
  {
    icon: "scale",
    title: "Apache 2.0",
    description: "Use it anywhere",
  },
];
</script>

<template>
  <section class="trust-signals">
    <div class="container">
      <div class="signals">
        <div v-for="signal in signals" :key="signal.title" class="signal">
          <div class="signal-icon">
            <svg
              v-if="signal.icon === 'lock'"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
            >
              <rect x="3" y="11" width="18" height="11" rx="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            <svg
              v-else-if="signal.icon === 'file'"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
            >
              <path
                d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"
              />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
            </svg>
            <svg
              v-else-if="signal.icon === 'code'"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
            >
              <polyline points="16 18 22 12 16 6" />
              <polyline points="8 6 2 12 8 18" />
            </svg>
            <svg
              v-else-if="signal.icon === 'scale'"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
            >
              <path d="M12 3v18" />
              <path d="M3 12h18" />
              <path d="M8 6l8 0" />
              <path d="M5 9l3-3-3-3" />
              <path d="M19 9l-3-3 3-3" />
            </svg>
          </div>
          <div class="signal-content">
            <span class="signal-title">{{ signal.title }}</span>
            <span class="signal-description">{{ signal.description }}</span>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.trust-signals {
  padding: 48px 24px;
  background: var(--vp-c-bg-soft);
  border-top: 1px solid var(--vp-c-divider);
  border-bottom: 1px solid var(--vp-c-divider);
}

@media (min-width: 640px) {
  .trust-signals {
    padding: 64px 48px;
  }
}

.container {
  max-width: 1152px;
  margin: 0 auto;
}

.signals {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 24px;
}

@media (min-width: 768px) {
  .signals {
    grid-template-columns: repeat(4, 1fr);
    gap: 32px;
  }
}

.signal {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 12px;
}

@media (min-width: 768px) {
  .signal {
    flex-direction: row;
    text-align: left;
    gap: 16px;
  }
}

.signal-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  border-radius: 10px;
  background: var(--vp-c-bg);
  color: var(--vp-c-brand-1);
  flex-shrink: 0;
}

.signal-content {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.signal-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--vp-c-text-1);
}

.signal-description {
  font-size: 13px;
  color: var(--vp-c-text-2);
}
</style>
