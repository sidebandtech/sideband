<template>
  <div class="hero-extras">
    <div class="extra-item">
      <span class="icon">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="3"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
      </span>
      Open protocol
    </div>
    <div class="extra-item">
      <span class="icon">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="3"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
      </span>
      Self-hostable
    </div>
    <div class="extra-item">
      <span class="icon">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="3"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
      </span>
      No lock-in
    </div>
  </div>
</template>

<style scoped>
.hero-extras {
  display: flex;
  justify-content: center;
  align-items: center;
  flex-wrap: wrap;
  gap: 16px 24px;
  margin-top: 20px;
  margin-bottom: 40px;
}

.extra-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 500;
  color: var(--vp-c-text-2);
}

.extra-item .icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background-color: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
}

.extra-item .icon svg {
  width: 12px;
  height: 12px;
}
</style>
