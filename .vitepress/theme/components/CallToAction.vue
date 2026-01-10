<template>
  <section class="call-to-action">
    <div class="container">
      <h2 class="title">Ready to delete your WebSocket code?</h2>
      <p class="subtitle">Get started in minutes with the Sideband SDK.</p>
      <div class="actions">
        <a href="/guide/" class="button primary">
          Get Started
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M3 8h10M9 4l4 4-4 4"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </a>
        <a href="/protocols/" class="button secondary">
          Read the Protocol Spec
        </a>
      </div>
    </div>
  </section>
</template>

<style scoped>
.call-to-action {
  padding: 80px 24px;
  background: var(--vp-c-bg);
}

@media (min-width: 640px) {
  .call-to-action {
    padding: 120px 48px;
  }
}

.container {
  max-width: 640px;
  margin: 0 auto;
  text-align: center;
}

.title {
  font-size: 28px;
  font-weight: 700;
  line-height: 1.2;
  margin-bottom: 16px;
}

@media (min-width: 640px) {
  .title {
    font-size: 36px;
  }
}

.subtitle {
  font-size: 18px;
  color: var(--vp-c-text-2);
  margin-bottom: 32px;
  line-height: 1.6;
}

.actions {
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: center;
}

@media (min-width: 480px) {
  .actions {
    flex-direction: row;
    justify-content: center;
    gap: 16px;
  }
}

.button {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 12px 24px;
  border-radius: 8px;
  font-size: 15px;
  font-weight: 500;
  text-decoration: none;
  transition: all 0.2s;
}

.button.primary {
  background: var(--vp-c-brand-3);
  color: var(--vp-c-white);
}

.button.primary:hover {
  background: var(--vp-c-brand-2);
}

.button.secondary {
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-1);
  border: 1px solid var(--vp-c-divider);
}

.button.secondary:hover {
  background: var(--vp-c-bg-alt);
  border-color: var(--vp-c-brand-1);
}
</style>
