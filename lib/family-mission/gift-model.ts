export type GiftIdea = {
 id: string;
 title: string;
 child: 'Paula' | 'Alejandra';
 occasion: 'unassigned' | 'birthday' | 'christmas';
 status: 'idea' | 'bought';
 notes?: string;
 createdBy: string;
 createdAt: string;
 updatedAt: string;
 revision: number;
};
export type GiftFields = Pick<GiftIdea, 'title' | 'child' | 'occasion' | 'status' | 'notes'>;
