<script setup lang="ts">
const useCases = [
  {
    icon: "robot",
    title: "Local AI Agents",
    description:
      "Give your AI agent a browser UI without exposing localhost or managing WebSocket state machines.",
  },
  {
    icon: "tools",
    title: "Developer Tools",
    description:
      "Build CLI companions, dashboard GUIs, and debugging interfaces that work across any network.",
  },
  {
    icon: "database",
    title: "Local-First Apps",
    description:
      "Keep data on the user's machine while providing a polished browser experience from anywhere.",
  },
];
</script>

<template>
  <section class="use-cases">
    <div class="container">
      <h2 class="title">Built For</h2>
      <p class="subtitle">
        Sideband is designed for developers building tools that need reliable
        browser-to-daemon communication.
      </p>

      <div class="cards">
        <article v-for="useCase in useCases" :key="useCase.title" class="card">
          <div class="icon">
            <svg
              v-if="useCase.icon === 'robot'"
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
            >
              <rect x="3" y="8" width="18" height="12" rx="2" />
              <circle cx="9" cy="14" r="2" />
              <circle cx="15" cy="14" r="2" />
              <path d="M12 2v4" />
              <circle cx="12" cy="2" r="1" />
            </svg>
            <svg
              v-else-if="useCase.icon === 'tools'"
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
            >
              <path
                d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"
              />
            </svg>
            <svg
              v-else-if="useCase.icon === 'database'"
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
            >
              <ellipse cx="12" cy="5" rx="9" ry="3" />
              <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
              <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
            </svg>
          </div>
          <h3 class="card-title">{{ useCase.title }}</h3>
          <p class="card-description">{{ useCase.description }}</p>
        </article>
      </div>
    </div>
  </section>
</template>

<style scoped>
.use-cases {
  padding: 64px 24px;
  background: var(--vp-c-bg);
}

@media (min-width: 640px) {
  .use-cases {
    padding: 96px 48px;
  }
}

.container {
  max-width: 1152px;
  margin: 0 auto;
}

.title {
  font-size: 32px;
  font-weight: 700;
  line-height: 1.2;
  text-align: center;
  margin-bottom: 16px;
}

@media (min-width: 640px) {
  .title {
    font-size: 40px;
  }
}

.subtitle {
  font-size: 18px;
  color: var(--vp-c-text-2);
  text-align: center;
  max-width: 640px;
  margin: 0 auto 48px;
  line-height: 1.6;
}

.cards {
  display: grid;
  gap: 24px;
}

@media (min-width: 768px) {
  .cards {
    grid-template-columns: repeat(3, 1fr);
    gap: 32px;
  }
}

.card {
  padding: 32px;
  border-radius: 12px;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  text-align: center;
}

.icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 64px;
  height: 64px;
  border-radius: 12px;
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
  margin-bottom: 20px;
}

.card-title {
  font-size: 20px;
  font-weight: 600;
  margin-bottom: 12px;
  color: var(--vp-c-text-1);
}

.card-description {
  font-size: 15px;
  color: var(--vp-c-text-2);
  line-height: 1.6;
}
</style>
