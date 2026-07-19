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

import { Stage, Layer, Rect, Text, Line, Group, Label, Tag } from 'react-konva'
import type { BoardLayerLayout, BoardColumn, BoardPiece } from '../types'

interface Props {
  layout: BoardLayerLayout
  wallL: number     // мм
  wallH: number     // мм
  canvasW: number   // px
  firstStud?: number // мм — первая стойка (для шкалы шага профиля)
  step?: number      // мм — шаг стоек
}

const PAD   = 40   // отступ слева/справа в px
const V_PAD = 30   // сверху/снизу

const COLORS: Record<BoardPiece['kind'], string> = {
  full:         '#4a90d9',
  width_cut:    '#f5a623',
  height_cut:   '#7ed321',
  both_cut:     '#9b59b6',
  opening_void: '#d0d0d0',
  diagonal_cut: '#e74c3c',
}

const KIND_LABELS: Record<BoardPiece['kind'], string> = {
  full:         'целый',
  width_cut:    'рез по ширине',
  height_cut:   'рез по высоте',
  both_cut:     'два реза',
  opening_void: 'проём',
  diagonal_cut: 'рез по уклону',
}

const STUD_RULER_H = 28  // px — высота шкалы стоек сверху

/**
 * Округление размера куска для подписи на схеме.
 * Реальный расчёт (площадь, отходы) считается по точной дробной высоте
 * из линейной интерполяции уклона — это нужно для точности сметы.
 * Но резать лист монтажник может только по целому мм, поэтому в подписи
 * на схеме дробь (типа 1257.4675324675327) округляем до целого мм —
 * иначе цифры на экране не читаются и не имеют смысла на объекте.
 */
function fmtMm(n: number): number {
  return Math.round(n)
}

export default function SheetLayoutCanvas({ layout, wallL, wallH, canvasW, firstStud, step }: Props) {
  const drawW = canvasW - PAD * 2
  const scaleX = wallL > 0 ? drawW / wallL : 1
  const scaleY = wallH > 0 ? (canvasW * 0.55) / wallH : 1
  const scale  = Math.min(scaleX, scaleY)

  const hasStudRuler = firstStud != null && step != null && step > 0
  const rulerH = hasStudRuler ? STUD_RULER_H : 0

  const canvasH = wallH * scale + V_PAD * 2 + 40 + rulerH

  const tx = (mm: number) => PAD + mm * scale
  const ty = (mm: number) => rulerH + V_PAD + (wallH - mm) * scale  // Y перевёрнут; ниже шкалы стоек

  // Позиции стоек для шкалы
  const studPositions: number[] = []
  if (hasStudRuler) {
    let x = firstStud!
    while (x <= wallL) {
      studPositions.push(x)
      x += step!
    }
  }

  return (
    <div>
      <Stage width={canvasW} height={canvasH}>
        <Layer>
          {/* Фон */}
          <Rect x={0} y={0} width={canvasW} height={canvasH} fill="#f8f8f8" />

          {/* ── Шкала стоек сверху ── */}
          {hasStudRuler && (() => {
            const minPxBetween = 28  // минимум px между метками чтобы не налезали
            return (
              <>
                {/* Фон шкалы */}
                <Rect x={0} y={0} width={canvasW} height={rulerH} fill="#f0f4f8" />
                {/* Горизонтальная линия — граница шкалы */}
                <Line points={[PAD, rulerH - 1, canvasW - PAD, rulerH - 1]} stroke="#aaa" strokeWidth={0.5} />
                {/* Метка "ПС:" */}
                <Text x={2} y={rulerH / 2 - 6} text="ПС:" fontSize={9} fill="#666" />

                {studPositions.map((xMm, idx) => {
                  const px = tx(xMm)
                  // Проверяем минимальное расстояние от предыдущей метки
                  const prevPx = idx > 0 ? tx(studPositions[idx - 1]) : -999
                  const showLabel = px - prevPx >= minPxBetween

                  return (
                    <React.Fragment key={`stud-${idx}`}>
                      {/* Вертикальная риска */}
                      <Line
                        points={[px, rulerH - 10, px, rulerH - 1]}
                        stroke="#2d7d46"
                        strokeWidth={1.5}
                      />
                      {/* Метка мм */}
                      {showLabel && (
                        <Text
                          x={px - 20}
                          y={rulerH - 22}
                          width={40}
                          text={`${xMm}`}
                          fontSize={9}
                          fill="#2d7d46"
                          align="center"
                        />
                      )}
                    </React.Fragment>
                  )
                })}
              </>
            )
          })()}

          {/* Колонки и куски */}
          {layout.columns.map((col: BoardColumn, ci: number) => (
            col.pieces.map((p: BoardPiece, pi: number) => {
              const px = tx(p.x)
              const py = ty(p.y + p.h)
              const pw = p.w * scale
              const ph = p.h * scale

              // ── Проём: штриховка поверх клиппинга ──────────────────────
              if (p.kind === 'opening_void') {
                const step = 10
                const diagLines: number[] = []
                // Линии идут сверху-влево → вниз-вправо (45°), sweep по диагонали
                for (let d = -ph; d < pw + step; d += step) {
                  diagLines.push(px + d, py, px + d + ph, py + ph)
                }
                const cw = Math.max(1, pw - 2)
                const ch = Math.max(1, ph - 2)
                return (
                  <Group key={`${ci}-${pi}`}
                    clip={{ x: px + 1, y: py + 1, width: cw, height: ch }}>
                    {/* Светлый фон проёма */}
                    <Rect x={px + 1} y={py + 1} width={cw} height={ch}
                      fill="#f0f0f0" opacity={0.9} />
                    {/* Диагональные линии */}
                    {diagLines.reduce<number[][]>((acc, _, i) =>
                      i % 4 === 0 ? [...acc, diagLines.slice(i, i + 4)] : acc, []
                    ).map((pts, li) => (
                      <Line key={li} points={pts} stroke="#b0b0b0" strokeWidth={0.8} />
                    ))}
                    {/* Подпись «проём» если достаточно места */}
                    {cw > 40 && ch > 18 && (
                      <Text x={px + 3} y={py + ch / 2 - 6}
                        width={cw - 6} text="проём"
                        fontSize={9} fill="#999" align="center" />
                    )}
                  </Group>
                )
              }

              // ── Кусок с резом по уклону: настоящий многоугольник ────────
              if (p.kind === 'diagonal_cut' && p.polygon && p.polygon.length >= 3) {
                const polyPts = p.polygon.flatMap(pt => [tx(pt.x), ty(pt.y)])
                const isOffcut = p.source === 'offcut'
                return (
                  <React.Fragment key={`${ci}-${pi}`}>
                    {/* Пунктиром — заготовка (сколько места реально занято на листе) */}
                    <Rect
                      x={px + 1} y={py + 1}
                      width={Math.max(1, pw - 2)}
                      height={Math.max(1, ph - 2)}
                      fill="transparent"
                      stroke="#bbb"
                      strokeWidth={1}
                      dash={[3, 3]}
                    />
                    {/* Реальная форма после реза по уклону */}
                    <Line
                      points={polyPts}
                      closed
                      fill={COLORS.diagonal_cut}
                      opacity={0.75}
                      stroke={isOffcut ? '#e74c3c' : '#fff'}
                      strokeWidth={isOffcut ? 1.5 : 0.5}
                    />
                    {pw > 30 && ph > 18 && (
                      <Text
                        x={px + 3} y={py + ph / 2 - 8}
                        width={pw - 6}
                        text={`${fmtMm(p.w)}×${fmtMm(p.h)}`}
                        fontSize={9}
                        fill="#fff"
                        align="center"
                      />
                    )}
                    {/* Точные высоты кромок у краёв косого реза — то, что
                        реально мерит монтажник при разметке (18.07.2026).
                        С подложкой (Label/Tag) — иначе у острия клина, где
                        высота кромки мала, подпись падает ВНЕ закрашенного
                        треугольника (на белый фон канваса) и белый текст
                        становится невидим. */}
                    {p.edgeHeightLeftMm != null && ph > 14 && (
                      <Label x={px} y={py + ph - 15}>
                        <Tag fill="#333" opacity={0.85} cornerRadius={2} />
                        <Text
                          text={`${fmtMm(p.edgeHeightLeftMm)}`}
                          fontSize={8}
                          fill="#fff"
                          padding={2}
                        />
                      </Label>
                    )}
                    {p.edgeHeightRightMm != null && ph > 14 && (
                      <Label x={px + pw} y={py + ph - 15} offsetX={28}>
                        <Tag fill="#333" opacity={0.85} cornerRadius={2} />
                        <Text
                          text={`${fmtMm(p.edgeHeightRightMm)}`}
                          fontSize={8}
                          fill="#fff"
                          padding={2}
                        />
                      </Label>
                    )}
                  </React.Fragment>
                )
              }

              // ── Обычный кусок ───────────────────────────────────────────
              const fill = COLORS[p.kind]
              const isOffcut = p.source === 'offcut'

              return (
                <React.Fragment key={`${ci}-${pi}`}>
                  <Rect
                    x={px + 1} y={py + 1}
                    width={Math.max(1, pw - 2)}
                    height={Math.max(1, ph - 2)}
                    fill={fill}
                    opacity={0.75}
                    stroke={isOffcut ? '#e74c3c' : '#fff'}
                    strokeWidth={isOffcut ? 1.5 : 0.5}
                    dash={isOffcut ? [3, 2] : undefined}
                  />
                  {/* Размеры куска */}
                  {pw > 30 && ph > 18 && (
                    <Text
                      x={px + 3} y={py + ph / 2 - 8}
                      width={pw - 6}
                      text={`${fmtMm(p.w)}×${fmtMm(p.h)}`}
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
                points={[tx(col.x1), rulerH + V_PAD, tx(col.x1), rulerH + V_PAD + wallH * scale]}
                stroke="#666" strokeWidth={0.5} dash={[4, 3]}
              />
              {/* Подпись ширины колонки */}
              <Text
                x={tx(col.x1) + 2}
                y={rulerH + V_PAD + wallH * scale + 4}
                text={`${col.x2 - col.x1}`}
                fontSize={9}
                fill="#555"
              />
            </React.Fragment>
          ))}
          {/* Правая граница */}
          <Line
            points={[tx(wallL), rulerH + V_PAD, tx(wallL), rulerH + V_PAD + wallH * scale]}
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
            x={tx(0)} y={rulerH + V_PAD}
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
        {/* Проём — штриховка */}
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <svg width="16" height="12" style={{ display: 'inline-block', verticalAlign: 'middle' }}>
            <rect width="16" height="12" fill="#f0f0f0" />
            {[0, 5, 10, 15, 20].map(d => (
              <line key={d} x1={d - 12} y1={0} x2={d} y2={12} stroke="#b0b0b0" strokeWidth="1" />
            ))}
          </svg>
          проём
        </span>
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
