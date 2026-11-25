import { test } from 'node:test'
import assert from 'node:assert/strict'
import { instructionNotes, toldOf, type Section } from '../src/telegram/told.ts'

const night = '\n\n# Night shift\nThe user is asleep. Decide yourself.'
const readOnly = '\n\n# Read-only topic\nRead and analyse only.'
const skills = '\n\n# Skills\n- one: does one thing'
const file = (content: string): Section => ({ id: 'file:C:/game/CLAUDE.md', sig: content, text: '# Project CLAUDE.md\nThis instruction file on the computer has changed, or is new: C:/game/CLAUDE.md.' })

test('nothing changed: nothing is said', () => {
  const sections: Section[] = [{ id: 'night', text: '', core: true }, { id: 'skills', text: skills }]
  assert.equal(instructionNotes(toldOf(sections), sections), '')
  assert.deepEqual(Object.keys(toldOf(sections)), ['skills'], 'what is not in force is not counted')
})

test('a section that begins, changes or ends is said once, by its text or by its name', () => {
  const before: Section[] = [{ id: 'night', text: '', core: true }, { id: 'read-only', text: readOnly, core: true }, { id: 'skills', text: skills }]
  const after: Section[] = [{ id: 'night', text: night, core: true }, { id: 'read-only', text: '', core: true }, { id: 'skills', text: `${skills}\n- two: does another` }]
  const said = instructionNotes(toldOf(before), after)
  assert.match(said, /^\[From the bot, not the user's words\. Your instructions have changed since this conversation began/)
  assert.match(said, /These sections are in force now, in place of any earlier version of them:\n\n# Night shift\nThe user is asleep\. Decide yourself\.\n\n# Skills\n- one: does one thing\n- two: does another\n\nNo longer in force: "# Read-only topic"\.\]$/)
  assert.equal(instructionNotes(toldOf(after), after), '', 'told, it is not said again')
})

test('only an ending: said without a list of sections', () => {
  const said = instructionNotes(toldOf([{ id: 'night', text: night }]), [{ id: 'night', text: '' }])
  assert.match(said, /what you were given then is all you see of them\.\n\nNo longer in force: "# Night shift"\.\]$/)
  assert.doesNotMatch(said, /These sections are in force/)
})

test('a conversation older than the count gets what matters most, and no pointers to files it may have as they are', () => {
  const sections: Section[] = [{ id: 'night', text: night, core: true }, { id: 'read-only', text: '', core: true }, { id: 'skills', text: skills }, file('v1')]
  const said = instructionNotes('legacy', sections)
  assert.match(said, /# Night shift/)
  assert.doesNotMatch(said, /# Skills|CLAUDE\.md|No longer in force/)
  assert.equal(instructionNotes('legacy', [{ id: 'skills', text: skills }, file('v1')]), '', 'nothing that matters: nothing said')
})

test('an instruction file is told by a pointer when its content changes, not by its text', () => {
  const known = toldOf([file('v1')])
  assert.equal(instructionNotes(known, [file('v1')]), '')
  const said = instructionNotes(known, [file('v2 with much more text')])
  assert.match(said, /# Project CLAUDE\.md\nThis instruction file on the computer has changed, or is new: C:\/game\/CLAUDE\.md\./)
  assert.doesNotMatch(said, /much more text/)
})
