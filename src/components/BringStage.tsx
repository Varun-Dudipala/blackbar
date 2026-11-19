// Stage 1: paste text, bring a photo or scan, or try a sample letter.

import { useRef, useState } from 'react'
import type { DeviceStatus, ImageInput } from '../ai/device'
import { transcribeImage } from '../ai/device'
import { fileToImageInput } from '../lib/image'
import { fixOcrConfusions, type OcrFix } from '../lib/ocr'
import { estimateTokens, ON_DEVICE_TOKEN_LIMIT } from '../lib/chunk'
import type { SampleLetter } from '../letters/samples'
import type { Letter } from '../state/session'
import type { CallRecord } from '../state/session'

interface Props {
  downloadNeeded: boolean
  samples: SampleLetter[]
  device: DeviceStatus
  prepare: () => Promise<boolean>
  current: Letter | null
  onLetter: (letter: Letter) => void
  onCall: (call: Omit<CallRecord, 'id'>) => void
}

type Mode = 'samples' | 'paste' | 'photo'

type Photo =
  | { status: 'reading'; previewUrl: string }
  | { status: 'review'; previewUrl: string; text: string; fixes: OcrFix[]; ms: number }
  | { status: 'error'; previewUrl?: string; message: string }

export function BringStage({ downloadNeeded, samples, device, prepare, current, onLetter, onCall }: Props) {
  const [mode, setMode] = useState<Mode>('samples')
  const [paste, setPaste] = useState('')
  const [photo, setPhoto] = useState<Photo | null>(null)
  const [dragging, setDragging] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const imagesOk = device.state === 'ready' ? device.images : device.state === 'downloadable' || device.state === 'downloading'

  const readFile = async (file: File | undefined) => {
    if (!file) return
    let input: { image: ImageInput; previewUrl: string }
    try {
      input = await fileToImageInput(file)
    } catch (e) {
      setPhoto({ status: 'error', message: e instanceof Error ? e.message : String(e) })
      return
    }
    setPhoto({ status: 'reading', previewUrl: input.previewUrl })
    const ready = await prepare()
    if (!ready) {
      setPhoto({ status: 'error', previewUrl: input.previewUrl, message: 'Reading a photo needs the on-device model, and this browser does not have it. Paste the text instead.' })
      return
    }
    try {
      const r = await transcribeImage(input.image)
      onCall({ label: r.call.label, side: 'on_device', ms: r.call.ms })
      const fixed = fixOcrConfusions(r.text)
      setPhoto({ status: 'review', previewUrl: input.previewUrl, text: fixed.text, fixes: fixed.fixes, ms: r.call.ms })
    } catch (e) {
      onCall({ label: 'Read photo', side: 'failed' })
      setPhoto({ status: 'error', previewUrl: input.previewUrl, message: e instanceof Error ? e.message : String(e) })
    }
  }

  const tokens = estimateTokens(paste)

  return (
    <div className="bring">
      <div className="tabs" role="tablist" aria-label="How to bring a letter">
        {(
          [
            ['samples', 'Try a sample'],
            ['paste', 'Paste text'],
            ['photo', 'Photo or scan'],
          ] as const
        ).map(([id, label]) => (
          <button key={id} type="button" role="tab" id={`tab-${id}`} aria-selected={mode === id} aria-controls={`panel-${id}`} className="tab" onClick={() => setMode(id)}>
            {label}
          </button>
        ))}
      </div>

      {mode === 'samples' && (
        <div role="tabpanel" id="panel-samples" aria-labelledby="tab-samples">
          <ul className="samples">
            {samples.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  className={`sample${current?.sampleId === s.id ? ' is-current' : ''}`}
                  data-sample={s.id}
                  aria-current={current?.sampleId === s.id ? 'true' : undefined}
                  onClick={() => onLetter({ text: s.text, origin: 'sample', title: s.title, sampleId: s.id })}
                >
                  <span className="sample-from">{s.from}</span>
                  <span className="sample-title">{s.title}</span>
                  <span className="sample-blurb">{s.blurb}</span>
                  <span className="sample-open" aria-hidden="true">
                    {current?.sampleId === s.id ? 'Sealed' : 'Seal'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <p className="fine">The samples are invented. Every name, number and address in them is fake.</p>
        </div>
      )}

      {mode === 'paste' && (
        <div role="tabpanel" id="panel-paste" aria-labelledby="tab-paste" className="paste">
          <label htmlFor="paste-text" className="field-label">
            Letter text
          </label>
          <textarea
            id="paste-text"
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            placeholder="Paste the whole letter, including the address block and reference numbers."
            rows={10}
            spellCheck={false}
          />
          <div className="paste-foot">
            <span className="fine">
              {paste.trim() ? `${paste.length.toLocaleString()} characters` : 'The text stays in this tab.'}
              {tokens > ON_DEVICE_TOKEN_LIMIT * 0.75 && ' Long letter: the on-device model reads it in parts, and the summary covers only the first part.'}
            </span>
            <button type="button" className="btn btn-ink" disabled={!paste.trim()} onClick={() => onLetter({ text: paste, origin: 'paste', title: 'Pasted letter' })}>
              Seal this letter
            </button>
          </div>
        </div>
      )}

      {mode === 'photo' && (
        <div role="tabpanel" id="panel-photo" aria-labelledby="tab-photo" className="photo">
          {!photo && (
            <div
              className={`drop${dragging ? ' is-over' : ''}${imagesOk ? '' : ' is-off'}`}
              onDragOver={(e) => {
                e.preventDefault()
                setDragging(true)
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault()
                setDragging(false)
                void readFile(e.dataTransfer.files[0])
              }}
            >
              <p className="drop-title">Drop a photo or scan of the letter here</p>
              <p className="fine">PNG or JPEG. The image is read by the on-device model and is never uploaded.</p>
              <button type="button" className="btn btn-ink" onClick={() => fileRef.current?.click()} disabled={!imagesOk}>
                Choose an image
              </button>
              {!imagesOk && <p className="fine warn">This browser's on-device model cannot read images. Paste the text instead.</p>}
              <input ref={fileRef} type="file" accept="image/png,image/jpeg" hidden onChange={(e) => void readFile(e.target.files?.[0])} data-testid="file-input" />
            </div>
          )}
          {photo && (
            <div className="photo-review">
              {photo.previewUrl && <img src={photo.previewUrl} alt="The letter you chose" className="photo-preview" />}
              <div className="photo-side">
                {photo.status === 'reading' && (
                  <div className="working" role="status">
                    <span className="ink-line" aria-hidden="true" />
                    <p>Reading the image on this device. This takes about 10 seconds.</p>
                  </div>
                )}
                {photo.status === 'error' && (
                  <div className="notice notice-error" role="alert">
                    <p>{photo.message}</p>
                  </div>
                )}
                {photo.status === 'review' && (
                  <>
                    <label htmlFor="ocr-text" className="field-label">
                      Check the transcription
                    </label>
                    <p className="fine">
                      Read on this device in {(photo.ms / 1000).toFixed(1)} s. Compare it with the paper before sealing. The model sometimes reads a zero as the letter O in ID numbers, and on a blurry photo it can leave out a line without any sign.
                    </p>
                    {photo.fixes.length > 0 && (
                      <ul className="fixes">
                        {photo.fixes.map((f) => (
                          <li key={f.index}>
                            Changed <code>{f.from}</code> to <code>{f.to}</code>. {f.why}
                          </li>
                        ))}
                      </ul>
                    )}
                    <textarea id="ocr-text" rows={12} value={photo.text} spellCheck={false} onChange={(e) => setPhoto({ ...photo, text: e.target.value })} />
                    <div className="paste-foot">
                      <button type="button" className="btn btn-quiet" onClick={() => setPhoto(null)}>
                        Use another image
                      </button>
                      <button type="button" className="btn btn-ink" disabled={!photo.text.trim()} onClick={() => onLetter({ text: photo.text, origin: 'image', title: 'Letter from a photo' })}>
                        Seal this text
                      </button>
                    </div>
                  </>
                )}
                {photo.status === 'error' && (
                  <button type="button" className="btn btn-quiet" onClick={() => setPhoto(null)}>
                    Try another image
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
      <aside className="how" aria-label="How Blackbar works">
        <p>
          <strong>How it works.</strong> Chrome's built-in model reads the letter on this computer and finds names and reference numbers. Pattern checks catch the standard formats, such as Social Security numbers and A-numbers. If you ask Gemini for help, it gets the sealed text only, and your real details are put back into the answer on this computer.
          {downloadNeeded && ' The first time, Chrome downloads its model (about 2.5 GB, a few minutes).'}
        </p>
      </aside>
    </div>
  )
}
