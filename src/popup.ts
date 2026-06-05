import { AVAILABLE_MODELS, DEFAULT_MODEL } from './api'
import type { StorageData, LibraryPrompt } from './types'

// ─── Element references ───────────────────────────────────────────────────────
// Grabbed once at the top — no need to query the DOM repeatedly

const apiKeyInput =
  document.getElementById('apiKey') as HTMLInputElement

const modelSelect =
  document.getElementById('modelSelect') as HTMLSelectElement

const modelDescription =
  document.getElementById('modelDescription') as HTMLDivElement

const includePageContextInput =
  document.getElementById('includePageContext') as HTMLInputElement

const promptList =
  document.getElementById('promptList') as HTMLDivElement

const promptLabelInput =
  document.getElementById('promptLabel') as HTMLInputElement

const promptTextInput =
  document.getElementById('promptText') as HTMLTextAreaElement

const addPromptBtn =
  document.getElementById('addPromptBtn') as HTMLButtonElement

// In-memory copy of the user's custom prompts, persisted to chrome.storage.sync
let customPrompts: LibraryPrompt[] = []

const saveBtn =
  document.getElementById('saveBtn') as HTMLButtonElement

const statusEl =
  document.getElementById('status') as HTMLDivElement

// ─── Populate model dropdown ──────────────────────────────────────────────────
// Build the <option> elements from the AVAILABLE_MODELS array
// so the HTML never needs to know about specific model IDs

const populateModelDropdown = (): void => {
  AVAILABLE_MODELS.forEach((model) => {
    const option = document.createElement('option')
    option.value = model.id
    option.textContent = model.label
    modelSelect.appendChild(option)
  })
}

// Updates the description text below the dropdown
// when the user changes the selected model
const updateModelDescription = (modelId: string): void => {
  const model = AVAILABLE_MODELS.find((m) => m.id === modelId)
  modelDescription.textContent = model?.description ?? ''
}

// ─── Load saved settings ──────────────────────────────────────────────────────
// Runs once when the popup opens — fills the inputs with whatever
// the user saved previously

const loadSavedSettings = (): void => {
  chrome.storage.sync.get(
    ['claudeApiKey', 'claudeModel', 'includePageContext'],
    (result: StorageData) => {
      // Fill API key field
      if (result.claudeApiKey) {
        apiKeyInput.value = result.claudeApiKey
      }

      // Set the dropdown to the saved model, or the default
      const savedModel = result.claudeModel ?? DEFAULT_MODEL
      modelSelect.value = savedModel
      updateModelDescription(savedModel)

      // Context scope — unset means "on", so only an explicit false unchecks it
      includePageContextInput.checked = result.includePageContext !== false

      // Custom prompts
      customPrompts = result.customPrompts ?? []
      renderPromptList()
    }
  )
}

// ─── Custom prompts ─────────────────────────────────────────────────────────────

// Persist the current list immediately so open pages pick it up live
const persistCustomPrompts = (): void => {
  chrome.storage.sync.set({ customPrompts })
}

const renderPromptList = (): void => {
  promptList.innerHTML = ''

  if (customPrompts.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'prompt-empty'
    empty.textContent = 'No custom prompts yet.'
    promptList.appendChild(empty)
    return
  }

  customPrompts.forEach((p, i) => {
    const row = document.createElement('div')
    row.className = 'prompt-row'

    const label = document.createElement('span')
    label.className = 'prompt-row-label'
    label.textContent = p.label

    const text = document.createElement('span')
    text.className = 'prompt-row-text'
    text.textContent = p.prompt

    const remove = document.createElement('button')
    remove.className = 'prompt-row-remove'
    remove.type = 'button'
    remove.textContent = '✕'
    remove.setAttribute('aria-label', `Remove ${p.label}`)
    remove.addEventListener('click', () => {
      customPrompts.splice(i, 1)
      persistCustomPrompts()
      renderPromptList()
    })

    // textContent (not innerHTML) so a prompt can never inject markup
    row.append(label, text, remove)
    promptList.appendChild(row)
  })
}

const addPrompt = (): void => {
  const label = promptLabelInput.value.trim()
  const prompt = promptTextInput.value.trim()
  if (!label || !prompt) {
    showStatus('Give the prompt a label and text', 'error')
    return
  }

  customPrompts.push({ label, prompt })
  persistCustomPrompts()
  renderPromptList()

  promptLabelInput.value = ''
  promptTextInput.value = ''
  promptLabelInput.focus()
  showStatus('Prompt added ✓', 'success')
}

// ─── Validation ───────────────────────────────────────────────────────────────

const validateApiKey = (key: string): string | null => {
  if (!key) return 'Please enter an API key'
  if (!key.startsWith('sk-ant-')) {
    return 'Invalid key — should start with sk-ant-'
  }
  return null // null means valid
}

// ─── Status helpers ───────────────────────────────────────────────────────────

const showStatus = (message: string, type: 'success' | 'error'): void => {
  statusEl.textContent = message
  statusEl.className = `status status--${type}`

  // Auto-clear success messages after 3 seconds
  if (type === 'success') {
    setTimeout(() => {
      if (statusEl.textContent === message) {
        statusEl.textContent = ''
        statusEl.className = 'status'
      }
    }, 3000)
  }
}

// ─── Save handler ─────────────────────────────────────────────────────────────

const saveSettings = (): void => {
  const apiKey = apiKeyInput.value.trim()
  const model = modelSelect.value

  // Validate before saving
  const error = validateApiKey(apiKey)
  if (error) {
    showStatus(error, 'error')
    return
  }

  const data: StorageData = {
    claudeApiKey: apiKey,
    claudeModel: model,
    includePageContext: includePageContextInput.checked,
    customPrompts,
  }

  chrome.storage.sync.set(data, () => {
    showStatus('Settings saved ✓', 'success')
  })
}

// ─── Event listeners ──────────────────────────────────────────────────────────

// Update description whenever the dropdown changes
modelSelect.addEventListener('change', () => {
  updateModelDescription(modelSelect.value)
})

// Save on button click
saveBtn.addEventListener('click', saveSettings)

// Add a custom prompt
addPromptBtn.addEventListener('click', addPrompt)

// Save on Enter key inside the API key field
apiKeyInput.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Enter') saveSettings()
})

// ─── Init ─────────────────────────────────────────────────────────────────────
// Run these when the popup opens

populateModelDropdown()
loadSavedSettings()