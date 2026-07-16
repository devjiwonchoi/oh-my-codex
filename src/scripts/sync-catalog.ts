#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import process from 'process';
import { validateCatalogManifest, summarizeCatalogCounts } from '../catalog/schema.js';
import { toPublicCatalogContract } from '../catalog/reader.js';

const CHECK_ONLY = process.argv.includes('--check');
const root = process.cwd();
const sourceManifestPath = join(root, 'src', 'catalog', 'manifest.json');
const templateManifestPath = join(root, 'templates', 'catalog-manifest.json');
const generatedDir = join(root, 'src', 'catalog', 'generated');
const generatedPublicCatalogPath = join(generatedDir, 'public-catalog.json');

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce((acc: Record<string, unknown>, key) => {
        acc[key] = canonicalize((value as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }
  return value;
}

function assertDeepEqual(label: string, actual: unknown, expected: unknown): void {
  const left = JSON.stringify(canonicalize(actual));
  const right = JSON.stringify(canonicalize(expected));
  if (left !== right) throw new Error(label);
}

function normalizePublicContract(contract: Record<string, unknown> | null | undefined): Record<string, unknown> | null | undefined {
  if (!contract || typeof contract !== 'object') return contract;
  return {
    version: contract.version,
    counts: contract.counts,
    coreSkills: contract.coreSkills,
    skills: contract.skills,
    agents: contract.agents,
    aliases: contract.aliases,
    internalHidden: contract.internalHidden,
  };
}

function main(): void {
  const manifestRaw = JSON.parse(readFileSync(sourceManifestPath, 'utf8'));
  const manifest = validateCatalogManifest(manifestRaw);
  const publicContract = toPublicCatalogContract(manifest);
  const expectedCounts = summarizeCatalogCounts(manifest);

  if (CHECK_ONLY) {
    const templateRaw = JSON.parse(readFileSync(templateManifestPath, 'utf8'));
    const template = validateCatalogManifest(templateRaw);
    assertDeepEqual('catalog_manifest_drift:template_content_mismatch', template, manifest);

    const generatedRaw = JSON.parse(readFileSync(generatedPublicCatalogPath, 'utf8')) as Record<string, unknown>;
    const generatedCounts = generatedRaw.counts as Record<string, unknown> | undefined;
    if (generatedCounts?.skillCount !== expectedCounts.skillCount || generatedCounts?.promptCount !== expectedCounts.promptCount) {
      throw new Error('catalog_generated_drift:counts_mismatch');
    }
    assertDeepEqual(
      'catalog_generated_drift:content_mismatch',
      normalizePublicContract(generatedRaw),
      normalizePublicContract(publicContract as unknown as Record<string, unknown>),
    );
    console.log('catalog check ok');
    return;
  }

  mkdirSync(generatedDir, { recursive: true });
  writeFileSync(templateManifestPath, JSON.stringify(manifest, null, 2));
  writeFileSync(generatedPublicCatalogPath, JSON.stringify(publicContract, null, 2));
  console.log(`wrote ${templateManifestPath}`);
  console.log(`wrote ${generatedPublicCatalogPath}`);
}

main();
