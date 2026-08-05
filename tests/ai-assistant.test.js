import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { asUser, registerUser } from './helpers.js';
import aiService from '../src/services/ai.service.js';

const API = '/api/ai';

describe('AI assistant endpoint', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns generated text for a valid assistant request', async () => {
    const { accessToken } = await registerUser();
    jest.spyOn(aiService, 'generateAssistantResponse').mockResolvedValue('A polished paragraph.');

    const response = await asUser(accessToken)
      .post(`${API}/generate`)
      .send({
        action: 'writeParagraph',
        prompt: 'Write a strong intro',
        selectedText: '',
        documentTitle: 'Draft',
        documentContent: '<p>Intro</p>',
      })
      .expect(200);

    expect(response.body).toMatchObject({
      text: 'A polished paragraph.',
    });
    expect(aiService.generateAssistantResponse).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'writeParagraph' }),
    );
  });

  it('rejects invalid actions before the service runs', async () => {
    const { accessToken } = await registerUser();
    const spy = jest.spyOn(aiService, 'generateAssistantResponse');

    const response = await asUser(accessToken)
      .post(`${API}/generate`)
      .send({ action: 'bad-action', prompt: 'Hello' })
      .expect(422);

    expect(response.body.success).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });
});
