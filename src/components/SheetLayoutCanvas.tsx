/**
 * Визуализация раскроя листов на Konva-канвасе.
 *
 * Цветовая схема:
 *   full        — синий (#4a90d9)         целый лист
 *   width_cut   — оранжевый (#f5a623)     резан по ширине
 *   height_cut  — зелёный (#7ed321)       резан по высоте
 *   both_cut    — фиолетовый (#9b59b6)    резан по ширине и высоте
 *   opening_void— серый (#cccccc)         проём
 *   offcut-src  — рамка пунктиром        кусок взят из пула обрезков
 */

import { Stage, Layer, Rect, Text, Line } from 'react-konva'
import type { BoardLayerLayout, BoardColumn, BoardPiece } from '../types'

interface Props {
  layout: BoardLayerLayout
  wallL: number   // мм
  wallH: number   // мм
  canvasW: number // px
}

const PAD   = 40   // отступ слева/справа в px
const V_PAD = 30   // сверху/снизу

const COLORS: Record<BoardPiece['kind'], string> = {
  full:         '#4a90d9',
  width_cut:    '#f5a623',
  height_cut:   '#7ed321',
  both_cut:     '#9b59b6',
  opening_void: '#d0d0d0',
}

const KIND_LABELS: Record<BoardPiece['kind'], string> = {
  full:         'целый',
  width_cut:    'рез по ширине',
  height_cut:   'рез по высоте',
  both_cut:     'два реза',
  opening_void: 'проём',
}

export default function SheetLayoutCanvas({ layout, wallL, wallH, canvasW }: Props) {
  const drawW = canvasW - PAD * 2
  const scaleX = wallL > 0 ? drawW / wallL : 1
  const scaleY = wallH > 0 ? (canvasW * 0.55) / wallH : 1
  const scale  = Math.min(scaleX, scaleY)

  const canvasH = wallH * scale + V_PAD * 2 + 40  // +40 под легенду

  const tx = (mm: number) => PAD + mm * scale
  const ty = (mm: number) => V_PAD + (wallH - mm) * scale  // Y перевёрнут

  return (
    <div>
      <Stage width={canvasW} height={canvasH}>
        <Layer>
          {/* Фон */}
          <Rect x={0} y={0} width={canvasW} height={canvasH} fill="#f8f8f8" />

          {/* Колонки и куски */}
          {layout.columns.map((col: BoardColumn, ci: number) => (
            col.pieces.map((p: BoardPiece, pi: number) => {
              const px = tx(p.x)
              const py = ty(p.y + p.h)
              const pw = p.w * scale
              const ph = p.h * scale

              const fill = COLORS[p.kind]
              const isVoid = p.kind === 'opening_void'
              const isOffcut = p.source === 'offcut'

              return (
                <React.Fragment key={`${ci}-${pi}`}>
                  <Rect
                    x={px + 1} y={py + 1}
                    width={Math.max(1, pw - 2)}
                    height={Math.max(1, ph - 2)}
                    fill={fill}
                    opacity={isVoid ? 0.35 : 0.75}
                    stroke={isOffcut ? '#e74c3c' : '#fff'}
                    strokeWidth={isOffcut ? 1.5 : 0.5}
                    dash={isOffcut ? [3, 2] : undefined}
                  />
                  {/* Размеры куска (если достаточно места) */}
                  {!isVoid && pw > 30 && ph > 18 && (
                    <Text
                      x={px + 3} y={py + ph / 2 - 8}
                      width={pw - 6}
                      text={`${p.w}×${p.h}`}
                      fontSize={9}
                      fill="#fff"
                      align="center"
                    />
                  )}
                </React.Fragment>
              )
            })
          ))}

          {/* Границы колонок (вертикальные линии = стыки листов) */}
          {layout.columns.map((col: BoardColumn, ci: number) => (
            <React.Fragment key={`col-${ci}`}>
              <Line
                points={[tx(col.x1), V_PAD, tx(col.x1), V_PAD + wallH * scale]}
                stroke="#666" strokeWidth={0.5} dash={[4, 3]}
              />
              {/* Подпись ширины колонки */}
              <Text
                x={tx(col.x1) + 2}
                y={V_PAD + wallH * scale + 4}
                text={`${col.x2 - col.x1}`}
                fontSize={9}
                fill="#555"
              />
            </React.Fragment>
          ))}
          {/* Правая граница */}
          <Line
            points={[tx(wallL), V_PAD, tx(wallL), V_PAD + wallH * scale]}
            stroke="#666" strokeWidth={0.5} dash={[4, 3]}
          />

          {/* Горизонтальные линии стыков — per-column, разная высота */}
          {layout.columns.map((col, ci) =>
            col.jointYs.map((yMm, ji) => (
              <Line
                key={`hj-${ci}-${ji}`}
                points={[tx(col.x1), ty(yMm), tx(col.x2), ty(yMm)]}
                stroke="#333"
                strokeWidth={1.5}
                dash={[8, 5]}
              />
            ))
          )}

          {/* Контур стены */}
          <Rect
            x={tx(0)} y={V_PAD}
            width={wallL * scale} height={wallH * scale}
            stroke="#333" strokeWidth={1.5} fill="transparent"
          />
        </Layer>
      </Stage>

      {/* ── Легенда ── */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 6, fontSize: 12 }}>
        {(Object.entries(KIND_LABELS) as [BoardPiece['kind'], string][])
          .filter(([k]) => k !== 'opening_void')
          .map(([kind, label]) => (
            <span key={kind} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ display: 'inline-block', width: 16, height: 12, background: COLORS[kind], borderRadius: 2, opacity: 0.8 }} />
              {label}
            </span>
          ))}
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ display: 'inline-block', width: 16, height: 12, border: '1.5px dashed #e74c3c', borderRadius: 2 }} />
          из обрезков
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <svg width="16" height="12" style={{ display: 'inline-block', verticalAlign: 'middle' }}>
            <line x1="0" y1="6" x2="16" y2="6" stroke="#333" strokeWidth="1.5" strokeDasharray="5 3" />
          </svg>
          стык листов
        </span>
      </div>
    </div>
  )
}

// Нужен React для Fragment
import React from 'react'
